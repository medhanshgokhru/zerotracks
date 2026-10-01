import { buildIndex } from "./index";
import type {
	DocumentRecord,
	SearchIndex,
	SearchOptions,
	SearchResponse,
	WebSearchPayload,
} from "./types";
import { domainOf, isValidExternalUrl, normalizeUrl } from "./url";

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
