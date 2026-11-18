import { documentDomain, searchableText } from "./index";
import { parseQuery } from "./query";
import { normalizeText, tokenize } from "./tokenizer";
import type { SearchIndex, SearchOptions, SearchResponse } from "./types";

function editDistance(left: string, right: string): number {
	let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
	for (let row = 1; row <= left.length; row += 1) {
		const current = [row];
		for (let column = 1; column <= right.length; column += 1) {
			current[column] = Math.min(
				current[column - 1] + 1,
				previous[column] + 1,
				previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1),
			);
		}
		previous = current;
	}
	return previous[right.length];
}

function fuzzyTerms(term: string, index: SearchIndex): string[] {
	if (index.postings[term] || term.length < 4) return [];
	const threshold = term.length < 7 ? 1 : 2;
	return index.vocabulary
		.map((candidate) => ({
			candidate,
			distance: editDistance(term, candidate),
		}))
		.filter(({ distance }) => distance > 0 && distance <= threshold)
		.sort(
			(left, right) =>
				left.distance - right.distance ||
				left.candidate.localeCompare(right.candidate),
		)
		.slice(0, 2)
		.map(({ candidate }) => candidate);
}

function matchesDomain(host: string, filter: string): boolean {
	const normalized = filter.toLocaleLowerCase("en-US").replace(/^www\./, "");
	return host === normalized || host.endsWith(`.${normalized}`);
}

export function searchIndex(
	index: SearchIndex,
	input: string,
	options: SearchOptions = {},
): SearchResponse {
	const query = parseQuery(input);
	const scores = new Map<string, number>();
	const candidateTerms = new Map<string, number>();
	for (const term of new Set(query.terms)) {
		candidateTerms.set(term, 1);
		if (options.fuzzy !== false) {
			for (const corrected of fuzzyTerms(term, index))
				candidateTerms.set(corrected, 0.48);
		}
	}

	const totalDocuments = index.documents.length;
	for (const [term, boost] of candidateTerms) {
		const documentFrequency = index.documentFrequency[term] ?? 0;
		const inverseFrequency = Math.log(
			1 +
				(totalDocuments - documentFrequency + 0.5) / (documentFrequency + 0.5),
		);
		for (const posting of index.postings[term] ?? []) {
			const weightedFrequency =
				posting.bodyTf + posting.descriptionTf * 1.5 + posting.titleTf * 2.6;
			const averageLength = index.averageDocumentLength || 1;
			const lengthFactor =
				1.2 * (1 - 0.75 + 0.75 * (posting.documentLength / averageLength));
			const bm25 =
				inverseFrequency *
				((weightedFrequency * 2.2) / (weightedFrequency + lengthFactor));
			scores.set(posting.id, (scores.get(posting.id) ?? 0) + bm25 * boost);
		}
	}

	const filtered = index.documents.filter((document) => {
		const host = documentDomain(document);
		const text = normalizeText(searchableText(document));
		const words = new Set(tokenize(searchableText(document), false));
		if (
			options.category &&
			options.category !== "all" &&
			document.category !== options.category
		)
			return false;
		if (
			options.domain &&
			options.domain !== "all" &&
			!matchesDomain(host, options.domain)
		)
			return false;
		if (query.domain && !matchesDomain(host, query.domain)) return false;
		if (query.url && !normalizeText(document.url).includes(query.url))
			return false;
		if (query.excludedTerms.some((term) => words.has(term))) return false;
		if (query.phrases.some((phrase) => !text.includes(phrase))) return false;
		if (candidateTerms.size > 0 && !scores.has(document.id)) return false;
		return true;
	});

	const phraseTokens = query.phrases.flatMap((phrase) => tokenize(phrase));
	const ranked = filtered.map((document) => {
		const text = normalizeText(searchableText(document));
		const phraseBoost =
			query.phrases.filter((phrase) => text.includes(phrase)).length * 2.5;
		const exactTermBoost = phraseTokens.reduce(
			(sum, term) => sum + (query.terms.includes(term) ? 0 : 0.05),
			0,
		);
		return {
			document,
			score: (scores.get(document.id) ?? 0) + phraseBoost + exactTermBoost,
		};
	});

	const sort = options.sort ?? "relevance";
	ranked.sort((left, right) => {
		if (sort === "newest")
			return (
				right.document.published.localeCompare(left.document.published) ||
				left.document.id.localeCompare(right.document.id)
			);
		if (sort === "title")
			return (
				left.document.title.localeCompare(right.document.title) ||
				left.document.id.localeCompare(right.document.id)
			);
		return (
			right.score - left.score ||
			left.document.title.localeCompare(right.document.title) ||
			left.document.id.localeCompare(right.document.id)
		);
	});

	const pageSize = Math.max(1, options.pageSize ?? 8);
	const page = Math.max(
		1,
		Math.min(
			options.page ?? 1,
			Math.max(1, Math.ceil(ranked.length / pageSize)),
		),
	);
	return {
		results: ranked.slice((page - 1) * pageSize, page * pageSize),
		total: ranked.length,
		page,
		pageSize,
		suggestions: query.terms.length ? [] : getLocalSuggestions(index, input),
	};
}

export function getLocalSuggestions(
	index: SearchIndex,
	input: string,
	limit = 6,
): string[] {
	const prefix = tokenize(input, false).at(-1) ?? "";
	if (prefix.length < 2 || input.includes(":") || input.includes('"'))
		return [];
	return index.vocabulary
		.filter((term) => term.startsWith(prefix) && term !== prefix)
		.slice(0, limit);
}

export function levenshteinDistance(left: string, right: string): number {
	return editDistance(left, right);
}
