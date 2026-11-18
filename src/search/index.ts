import { tokenize } from "./tokenizer";
import type { DocumentRecord, Posting, SearchIndex } from "./types";
import { domainOf, isValidExternalUrl, normalizeUrl } from "./url";

function termCounts(tokens: string[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
	return counts;
}

export function deduplicateDocuments(
	documents: DocumentRecord[],
): DocumentRecord[] {
	const unique = new Map<string, DocumentRecord>();
	for (const document of documents) {
		if (!isValidExternalUrl(document.url)) {
			continue;
		}
		const canonical = normalizeUrl(document.url);
		if (!unique.has(canonical)) unique.set(canonical, document);
	}
	return [...unique.values()];
}

export function buildIndex(inputDocuments: DocumentRecord[]): SearchIndex {
	const documents = deduplicateDocuments(inputDocuments);
	const postingLists = new Map<string, Posting[]>();
	let totalLength = 0;

	for (const document of documents) {
		const title = termCounts(tokenize(document.title));
		const description = termCounts(tokenize(document.description));
		const body = termCounts(
			tokenize(`${document.content} ${document.entities.join(" ")}`),
		);
		const allTokens = [
			...tokenize(document.title),
			...tokenize(document.description),
			...tokenize(`${document.content} ${document.entities.join(" ")}`),
		];
		const documentLength = allTokens.length;
		totalLength += documentLength;
		const terms = new Set(allTokens);

		for (const term of terms) {
			const posting = {
				id: document.id,
				titleTf: title.get(term) ?? 0,
				descriptionTf: description.get(term) ?? 0,
				bodyTf: body.get(term) ?? 0,
				documentLength,
			};
			const list = postingLists.get(term) ?? [];
			list.push(posting);
			postingLists.set(term, list);
		}
	}

	const postings = Object.fromEntries(
		[...postingLists.entries()].sort(([left], [right]) =>
			left.localeCompare(right),
		),
	);
	const documentFrequency = Object.fromEntries(
		Object.entries(postings).map(([term, list]) => [term, list.length]),
	);

	return {
		version: 1,
		documents,
		postings,
		documentFrequency,
		vocabulary: Object.keys(postings),
		averageDocumentLength: documents.length
			? totalLength / documents.length
			: 0,
	};
}

export function searchableText(document: DocumentRecord): string {
	return `${document.title} ${document.description} ${document.content} ${document.entities.join(" ")}`;
}

export function documentDomain(document: DocumentRecord): string {
	return domainOf(document.url);
}
