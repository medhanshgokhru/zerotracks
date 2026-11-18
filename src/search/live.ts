import { buildIndex, documentDomain, searchableText } from "./index";
import { tokenize } from "./tokenizer";
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
	const candidates = documents.flatMap((document, position) => {
		const text = `${document.title}. ${document.description}`.trim();
		const sentences = text
			.split(/(?<=[.!?])\s+|[\n\r]+/)
			.map((sentence) => sentence.trim())
			.filter((sentence) => sentence.length >= 20);
		return sentences.map((sentence) => ({
			sentence,
			position,
			score:
				tokenize(sentence).reduce(
					(count, term) => count + Number(queryTerms.has(term)),
					0,
				) + Math.max(0, 2 - position * 0.05),
		}));
	});

	const seen = new Set<string>();
	return candidates
		.sort(
			(left, right) =>
				right.score - left.score ||
				left.position - right.position ||
				left.sentence.localeCompare(right.sentence),
		)
		.map(({ sentence }) => sentence.replace(/[.!?]+$/, "").trim())
		.filter((sentence) => {
			const key = tokenize(sentence).join(" ");
			if (!key || seen.has(key)) return false;
			seen.add(key);
			return true;
		})
		.slice(0, Math.max(0, limit));
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
