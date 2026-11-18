import { buildIndex, documentDomain, searchableText } from "./index";
import { normalizeText, tokenize } from "./tokenizer";
import type {
	DocumentRecord,
	SearchIndex,
	SearchOptions,
	SearchResponse,
	WebSearchPayload,
} from "./types";
import { domainOf, isValidExternalUrl, normalizeUrl } from "./url";

export function buildExtractiveSummary(
	documents: DocumentRecord[],
	query: string,
	limit = 3,
): string[] {
	const queryTerms = new Set(tokenize(query));
	const queryPhrase = tokenize(query).join(" ");
	const candidates = documents.flatMap((document, position) => {
		const text = `${document.title}. ${document.description}`.trim();
		const sentences = text
			.split(/(?<=[.!?])\s+|[\n\r]+/)
			.map((sentence) => sentence.trim())
			.filter((sentence) => sentence.length >= 20);
		return sentences.map((sentence) => ({
			sentence,
			position,
			score: (() => {
				const sentenceTerms = tokenize(sentence);
				const matched = [...new Set(sentenceTerms)].filter((term) =>
					queryTerms.has(term),
				);
				const coverage =
					queryTerms.size > 0 ? matched.length / queryTerms.size : 0;
				const sentenceLengthPenalty =
					sentence.length > 180 ? (sentence.length - 180) * 0.01 : 0;
				return (
					coverage * 8 +
					matched.length * 2 +
					(queryPhrase && tokenize(sentence).join(" ").includes(queryPhrase)
						? 4
						: 0) +
					(position === 0 ? 1 : 0) -
					sentenceLengthPenalty
				);
			})(),
		}));
	});

	const seen = new Set<string>();
	const selected: string[] = [];
	const selectedTerms = new Set<string>();
	for (const candidate of [...candidates].sort(
		(left, right) =>
			right.score - left.score ||
			left.position - right.position ||
			left.sentence.localeCompare(right.sentence),
	)) {
		if (selected.length >= Math.max(0, limit)) break;
		const sentence = candidate.sentence.replace(/[.!?]+$/, "").trim();
		const key = tokenize(sentence).join(" ");
		if (!key || seen.has(key)) continue;
		const terms = tokenize(sentence);
		const uniqueTerms = [...new Set(terms)];
		const overlap = uniqueTerms.filter((term) =>
			selectedTerms.has(term),
		).length;
		if (selected.length > 0 && overlap / Math.max(1, uniqueTerms.length) > 0.72)
			continue;
		seen.add(key);
		selected.push(sentence);
		for (const term of uniqueTerms) selectedTerms.add(term);
	}
	return selected;
}

export function rankLiveResults(
	payload: WebSearchPayload,
	limit = 12,
): WebSearchPayload {
	const queryTerms = tokenize(payload.query);
	const domainCounts = new Map<string, number>();
	const ranked = payload.results
		.map((result, position) => {
			const title = normalizeText(result.title);
			const snippet = normalizeText(result.snippet);
			const domain = normalizeText(result.domain);
			let score =
				queryTerms.reduce((total, term) => {
					return (
						total +
						(title.includes(term) ? 5 : 0) +
						(snippet.includes(term) ? 3 : 0) +
						(domain.includes(term) ? 1 : 0)
					);
				}, 0) + Math.max(0, 2 - position * 0.08);
			if (title.length < 12) score -= 2;
			if (snippet.length < 35) score -= 1;
			if (/sponsored|advertisement|promo/i.test(`${title} ${snippet}`))
				score -= 8;
			return { result, score, position };
		})
		.filter(({ result }) => {
			if (!queryTerms.length) return true;
			const text = normalizeText(`${result.title} ${result.snippet}`);
			return queryTerms.some((term) => text.includes(term));
		})
		.sort(
			(left, right) =>
				right.score - left.score ||
				left.position - right.position ||
				left.result.title.localeCompare(right.result.title),
		)
		.map(({ result, score }, rank) => {
			const domain = normalizeText(result.domain);
			const repeats = domainCounts.get(domain) ?? 0;
			domainCounts.set(domain, repeats + 1);
			return {
				...result,
				position: rank + 1,
				_relevanceScore: score - repeats * 0.75,
			};
		})
		.sort(
			(left, right) =>
				right._relevanceScore - left._relevanceScore ||
				left.position - right.position,
		)
		.slice(0, Math.max(0, limit))
		.map(({ _relevanceScore, ...result }, index) => ({
			...result,
			position: index + 1,
		}));
	return { ...payload, results: ranked };
}

export async function searchWikipedia(
	query: string,
	options: {
		fetchImpl?: typeof fetch;
		signal?: AbortSignal;
	} = {},
): Promise<WebSearchPayload> {
	const fetchImpl = options.fetchImpl ?? fetch;
	const endpoint = new URL("https://en.wikipedia.org/w/api.php");
	endpoint.searchParams.set("action", "query");
	endpoint.searchParams.set("list", "search");
	endpoint.searchParams.set("srsearch", query);
	endpoint.searchParams.set("srlimit", "20");
	endpoint.searchParams.set("format", "json");
	endpoint.searchParams.set("origin", "*");

	const response = await fetchImpl(endpoint, {
		cache: "no-store",
		credentials: "omit",
		referrerPolicy: "no-referrer",
		signal: options.signal,
	});
	if (!response.ok) throw new Error("Wikipedia search is unavailable.");
	const payload = (await response.json()) as {
		query?: {
			search?: Array<{
				pageid: number;
				title: string;
				snippet: string;
			}>;
		};
	};
	const results = (payload.query?.search ?? []).map((hit, index) => ({
		id: `wikipedia:${hit.pageid}`,
		title: hit.title,
		url: `https://en.wikipedia.org/wiki/${encodeURIComponent(hit.title.replace(/ /g, "_"))}`,
		domain: "en.wikipedia.org",
		snippet: hit.snippet
			.replace(/<[^>]*>/g, " ")
			.replace(/\s+/g, " ")
			.trim(),
		source: "Wikipedia",
		position: index + 1,
	}));
	return {
		query,
		provider: "Wikipedia",
		results,
	};
}

export function rankRelatedDocuments(
	selected: DocumentRecord,
	documents: DocumentRecord[],
	limit = 3,
): Array<{ document: DocumentRecord; overlap: number }> {
	const selectedTerms = new Set(tokenize(searchableText(selected)));
	return documents
		.filter((document) => document.id !== selected.id)
		.map((document) => {
			const documentTerms = tokenize(searchableText(document));
			const overlap = documentTerms.reduce(
				(count, term) => count + Number(selectedTerms.has(term)),
				0,
			);
			const sameDomain = documentDomain(document) === documentDomain(selected);
			return { document, overlap: overlap + (sameDomain ? 2 : 0) };
		})
		.filter(({ overlap }) => overlap > 0)
		.sort(
			(left, right) =>
				right.overlap - left.overlap ||
				left.document.title.localeCompare(right.document.title),
		)
		.slice(0, Math.max(0, limit));
}

export function documentsFromWebSearch(
	payload: WebSearchPayload,
): DocumentRecord[] {
	const documents: DocumentRecord[] = [];
	const seen = new Set<string>();
	for (const hit of payload.results) {
		if (!isValidExternalUrl(hit.url)) continue;
		const url = normalizeUrl(hit.url);
		if (seen.has(url)) continue;
		seen.add(url);
		documents.push({
			id: `web:${url}`,
			title: hit.title,
			url,
			description: hit.snippet,
			content: "",
			category: "Web",
			published: "",
			source: hit.source || payload.provider,
			entities: [],
		});
	}
	return documents;
}

export function indexWebSearch(payload: WebSearchPayload): SearchIndex {
	return buildIndex(documentsFromWebSearch(payload));
}

export function paginateWebSearch(
	payload: WebSearchPayload,
	options: SearchOptions = {},
): SearchResponse {
	const pageSize = Math.max(1, options.pageSize ?? 6);
	let results = documentsFromWebSearch(payload).map((document, index) => ({
		document,
		score: 1 / (index + 1),
	}));

	if (
		options.category &&
		options.category !== "all" &&
		options.category !== "Web"
	) {
		results = [];
	}
	if (options.domain && options.domain !== "all") {
		results = results.filter(({ document }) => {
			const host = domainOf(document.url).replace(/^www\./, "");
			const filter =
				options.domain?.toLocaleLowerCase("en-US").replace(/^www\./, "") ?? "";
			return host === filter || host.endsWith(`.${filter}`);
		});
	}

	if (options.sort === "title") {
		results.sort(
			(left, right) =>
				left.document.title.localeCompare(right.document.title) ||
				left.document.url.localeCompare(right.document.url),
		);
	}

	const total = results.length;
	const page = Math.max(
		1,
		Math.min(options.page ?? 1, Math.max(1, Math.ceil(total / pageSize))),
	);
	return {
		results: results.slice((page - 1) * pageSize, page * pageSize),
		total,
		page,
		pageSize,
		suggestions: [],
	};
}
