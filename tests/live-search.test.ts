import { describe, expect, it } from "vitest";
import { buildInvestigationGraph } from "../src/graph/relationships";
import {
	documentsFromWebSearch,
	indexWebSearch,
	paginateWebSearch,
} from "../src/search/live";
import type { WebSearchPayload } from "../src/search/types";

const payload: WebSearchPayload = {
	query: "privacy search",
	provider: "DuckDuckGo",
	results: [
		{
			id: "one",
			title: "Privacy search guide",
			url: "https://example.org/privacy?utm_source=search",
			domain: "example.org",
			snippet: "A guide to privacy and search tools.",
			source: "DuckDuckGo",
			position: 1,
		},
		{
			id: "two",
			title: "Search privacy notes",
			url: "https://sub.example.org/notes",
			domain: "sub.example.org",
			snippet: "Notes about private search.",
			source: "DuckDuckGo",
			position: 2,
		},
		{
			id: "unsafe",
			title: "Unsafe result",
			url: "javascript:alert(1)",
			domain: "",
			snippet: "Must not appear.",
			source: "DuckDuckGo",
			position: 3,
		},
	],
};

describe("live search result adapters", () => {
	it("validates URLs and canonicalizes tracking variants", () => {
		const documents = documentsFromWebSearch(payload);
		expect(documents).toHaveLength(2);
		expect(documents[0].url).toBe("https://example.org/privacy");
	});

	it("filters, title-sorts, and paginates provider hits", () => {
		const response = paginateWebSearch(payload, {
			category: "all",
			domain: "example.org",
			sort: "title",
			pageSize: 1,
			page: 2,
		});
		expect(response.total).toBe(2);
		expect(response.results[0]?.document.title).toBe("Search privacy notes");
	});

	it("adapts live records for the existing relationship graph", () => {
		const graph = buildInvestigationGraph(
			indexWebSearch(payload),
			"web:https://example.org/privacy",
		);
		expect(graph.nodes[0]?.type).toBe("document");
		expect(
			graph.nodes.some(
				(node) => node.type === "domain" && node.label === "example.org",
			),
		).toBe(true);
	});
});
