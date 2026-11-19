import { buildIndex, documentDomain, searchableText } from "./index";
import { cleanDisplayText, normalizeText, tokenize } from "./tokenizer";
import type {
	DocumentRecord,
	SearchIndex,
	SearchOptions,
	SearchResponse,
	WebSearchPayload,
} from "./types";
import { domainOf, isValidExternalUrl, normalizeUrl } from "./url";

export function sourceReliabilitySignal(domain: string): number {
	const normalized = domain.toLocaleLowerCase("en-US").replace(/^www\./, "");
	if (normalized.endsWith(".gov") || normalized.endsWith(".gov.uk")) return 0.9;
	if (normalized.endsWith(".edu") || normalized.endsWith(".ac.uk")) return 0.7;
	if (normalized === "wikipedia.org" || normalized.endsWith(".wikipedia.org"))
		return 0.55;
	if (normalized.startsWith("docs.") || normalized.includes(".docs."))
		return 0.45;
	return 0;
}

export function isVerifiedOverviewSource(
	document: DocumentRecord,
	query: string,
): boolean {
	const domain = documentDomain(document).toLocaleLowerCase("en-US");
	const normalized = domain.replace(/^www\./, "");
	const queryTerms = tokenize(query);
	const compactQuery = queryTerms.join("");
	const labels = normalized.split(".");
	const rootDomain =
		labels.length >= 3 && (labels.at(-2) === "com" || labels.at(-2) === "org")
			? labels.slice(-3).join(".")
			: labels.slice(-2).join(".");
	const domainBase = rootDomain.split(".")[0];
	const isOfficialQueryDomain =
		queryTerms.length === 1 &&
		(domainBase === compactQuery ||
			rootDomain.startsWith(`${compactQuery}.`) ||
			normalized === `${compactQuery}.com` ||
			normalized === `${compactQuery}.org`);
	if (
		normalized === "facebook.com" ||
		normalized.endsWith(".facebook.com") ||
		normalized === "instagram.com" ||
		normalized.endsWith(".instagram.com") ||
		normalized === "x.com" ||
		normalized.endsWith(".x.com") ||
		normalized === "tiktok.com" ||
		normalized.endsWith(".tiktok.com")
	)
		return false;
	return (
		isOfficialQueryDomain ||
		sourceReliabilitySignal(normalized) > 0 ||
		normalized === "www.imdb.com" ||
		normalized === "imdb.com"
	);
}

export function buildExtractiveSummary(
	documents: DocumentRecord[],
	query: string,
	limit = 3,
): string[] {
	const queryTerms = new Set(tokenize(query));
	const queryPhrase = tokenize(query).join(" ");
	const candidates = documents.flatMap((document, position) => {
		const text =
			`${cleanDisplayText(document.title)}. ${cleanDisplayText(document.description)}`.trim();
		const sentences = text
			.split(/(?<=[.!?;])\s+|[\n\r]+/)
			.map((sentence) =>
				sentence
					.trim()
					.replace(
						/\b([\p{L}][\p{L}\p{N}-]*)\b(?:\s*[,|/-]?\s*\1\b)+/giu,
						"$1",
					),
			)
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
	const selectedPositions = new Set<number>();
	const selected: string[] = [];
	const selectedTerms = new Set<string>();
	for (const candidate of [...candidates].sort(
		(left, right) =>
			right.score - left.score ||
			left.position - right.position ||
			left.sentence.localeCompare(right.sentence),
	)) {
		if (selected.length >= Math.max(0, limit)) break;
		if (selectedPositions.has(candidate.position)) continue;
		const sentence = cleanDisplayText(
			candidate.sentence.replace(/[.!?]+$/, ""),
		);
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
		selectedPositions.add(candidate.position);
		selected.push(sentence);
		for (const term of uniqueTerms) selectedTerms.add(term);
	}
	return selected;
}

export type AiSummary = {
	intro: string;
	points: string[];
};

function overviewSourceRank(document: DocumentRecord, queryTerms: string[]) {
	const domain = documentDomain(document).toLowerCase();
	const title = cleanDisplayText(document.title).toLowerCase();
	let rank = 0;
	if (domain === "en.wikipedia.org" || domain.endsWith(".wikipedia.org"))
		rank += 40;
	if (domain === "www.britannica.com") rank += 35;
	if (domain === "www.imdb.com") rank += 35;
	if (domain === "wikitia.com") rank += 50;
	if (domain.endsWith(".gov") || domain.endsWith(".edu")) rank += 50;
	if (domain === "mickey.disney.com" || domain.endsWith(".disney.com"))
		rank += 20;
	if (
		title.includes("full episodes") ||
		title.includes("episode") ||
		title.includes("compilation") ||
		title.includes("season ")
	)
		rank -= 30;
	if (domain.includes("youtube.com") || domain.includes("fandom.com"))
		rank -= 25;
	if (
		domain === "www.instagram.com" ||
		domain === "instagram.com" ||
		domain === "x.com" ||
		domain === "www.x.com"
	)
		rank -= 40;
	if (
		title.includes("age") ||
		title.includes("girlfriend") ||
		title.includes("family") ||
		title.includes("net worth") ||
		title.includes("dating") ||
		title.includes("relationship")
	)
		rank -= 35;
	if (
		domain.includes("starsunfolded") ||
		domain.includes("wikibio") ||
		domain.includes("leaderbiography") ||
		domain.includes("newsx")
	)
		rank -= 30;
	rank += queryTerms.reduce(
		(total, term) => total + (title.includes(term) ? 4 : 0),
		0,
	);
	return rank;
}

function firstCompleteSentence(snippet: string) {
	const clean = cleanDisplayText(snippet).replace(/\s+/g, " ").trim();
	if (clean.length < 35) return "";
	const withoutEllipsis = clean
		.split(/\.\.\.|…/)[0]
		.replace(/\s+[.!?]*$/, "")
		.trim();
	if (
		/\b\d+(?:\.\d+)?[KMB]?\s+(?:followers|following|posts)\b/i.test(clean) ||
		/\b(?:followers|following|posts)\s*[-–]\b/i.test(clean)
	)
		return "";
	if (
		/\b\d+(?:\.\d+)?[KMB]?\s+(?:youtube\s+)?(?:subscribers|views)\b/i.test(
			clean,
		)
	)
		return "";
	if (/\b(?:review|rating|trailer|subscribe)\b/i.test(clean)) return "";
	if (
		/\b(?:girlfriend|boyfriend|dating|net worth|height|weight|age)\b/i.test(
			clean,
		)
	)
		return "";
	if (/^(?:he gave up|before .+ was|did they date)\b/i.test(clean)) return "";
	if (/^(?:met ashish|i(?:a)?m happy|who is ashish)\b/i.test(clean)) return "";
	if (/^(?:explore|discover|watch|visit|learn|find|shop)\b/i.test(clean))
		return "";
	const cleaned = withoutEllipsis
		.replace(/\[\d+(?:-\d+)?\]/g, "")
		.replace(/\[[^\]]*[ˈˌɪʊəɛɑɔʒθðʃ][^\]]*\]/g, "")
		.replace(/\s*\([^)]*pronounced[^)]*\)/gi, "")
		.replace(/\s{2,}/g, " ")
		.trim();
	if (cleaned.length < 35) return "";
	const match = cleaned.match(/^.{35}[^.!?]*[.!?]/);
	if (match) return match[0].trim();
	const sentenceEnd = cleaned.search(/[.!?](?:\s|$)/);
	return sentenceEnd >= 35 ? cleaned.slice(0, sentenceEnd + 1).trim() : "";
}

export function buildAiSummary(
	documents: DocumentRecord[],
	query: string,
	_limit = 3,
): AiSummary | null {
	if (!documents.length) return null;
	const cleanQuery = cleanDisplayText(query);
	const terms = [...new Set(tokenize(cleanQuery))].slice(0, 3);
	const focus = terms.length ? terms.join(", ") : "the current topic";
	const snippets = [...documents]
		.filter((document) => isVerifiedOverviewSource(document, cleanQuery))
		.sort(
			(left, right) =>
				overviewSourceRank(right, terms) - overviewSourceRank(left, terms),
		)
		.flatMap((document) => {
			const domain = documentDomain(document).toLowerCase();
			const title = cleanDisplayText(document.title).toLowerCase();
			if (
				domain === "www.instagram.com" ||
				domain === "instagram.com" ||
				domain === "x.com" ||
				domain === "www.x.com" ||
				domain.includes("youtube.com")
			)
				return [];
			if (
				title.includes("dating") ||
				title.includes("girlfriend") ||
				title.includes("family") ||
				title.includes("net worth") ||
				title.includes("age") ||
				title.includes("full episode") ||
				title.includes("season ")
			)
				return [];
			const snippet = firstCompleteSentence(
				document.description || document.content,
			);
			return snippet ? [snippet] : [];
		})
		.filter(Boolean)
		.filter((snippet, index, all) => all.indexOf(snippet) === index)
		.slice(0, 2);
	const domains = [...new Set(documents.map(documentDomain))]
		.filter(Boolean)
		.slice(0, 4);
	const detail = snippets.join(" ");
	const intro = detail
		? detail
		: `${focus ? `Search coverage of ${focus}` : "Search coverage"} includes ${domains.join(", ")}.`;
	return {
		intro,
		points: snippets,
	};
}

export function rankLiveResults(
	payload: WebSearchPayload,
	limit = 12,
): WebSearchPayload {
	const queryTerms = tokenize(payload.query);
	const domainCounts = new Map<string, number>();
	const ranked = payload.results
		.map((result, position) => {
			const title = cleanDisplayText(result.title);
			const snippet = cleanDisplayText(result.snippet);
			const domain = normalizeText(result.domain);
			const rawDomain = result.domain
				.toLocaleLowerCase("en-US")
				.replace(/^www\./, "");
			let score =
				queryTerms.reduce((total, term) => {
					return (
						total +
						(title.includes(term) ? 5 : 0) +
						(snippet.includes(term) ? 3 : 0) +
						(domain.includes(term) ? 1 : 0)
					);
				}, 0) +
				Math.max(0, 2 - position * 0.08) +
				sourceReliabilitySignal(domain) * 0.8;
			const labels = rawDomain.split(".");
			const rootDomain =
				labels.length >= 3 &&
				(labels.at(-2) === "co" ||
					labels.at(-2) === "com" ||
					labels.at(-2) === "org")
					? labels.slice(-3).join(".")
					: labels.slice(-2).join(".");
			const domainBase = rootDomain.split(".")[0];
			const compactQuery = queryTerms.join("");
			if (
				queryTerms.length === 1 &&
				(domainBase === compactQuery ||
					rootDomain.startsWith(`${compactQuery}.`) ||
					rawDomain === `${compactQuery}.com` ||
					rawDomain === `${compactQuery}.org`)
			)
				score += 120;
			else if (
				queryTerms.length === 1 &&
				(rawDomain.includes(`.${compactQuery}.`) ||
					rawDomain.endsWith(`.${compactQuery}.com`) ||
					rawDomain.endsWith(`.${compactQuery}.org`))
			)
				score += 55;
			if (
				(/^(www\.)?(facebook|instagram|twitter|tiktok|youtube)\./.test(
					rawDomain,
				) ||
					/wikipedia\.org$/i.test(rawDomain)) &&
				!queryTerms.includes(domainBase)
			)
				score -= 25;
			if (title.toLocaleLowerCase("en-US") === queryTerms.join(" "))
				score += 12;
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
			title: cleanDisplayText(hit.title),
			url,
			description: cleanDisplayText(hit.snippet),
			content: "",
			category: "Web",
			published: "",
			source: hit.source || payload.provider,
			entities: [],
			image: hit.image,
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
