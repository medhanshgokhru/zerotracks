import { describe, expect, it } from "vitest";
import { buildInvestigationGraph } from "../src/graph/relationships";
import {
	buildExtractiveSummary,
	documentsFromWebSearch,
	indexWebSearch,
	paginateWebSearch,
	rankLiveResults,
	rankRelatedDocuments,
	searchWikipedia,
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
	it("provides a CORS-enabled Wikipedia fallback without a gateway", async () => {
		const payload = await searchWikipedia("privacy", {
			fetchImpl: async () =>
				new Response(
					JSON.stringify({
						query: {
							search: [
								{
									pageid: 123,
									title: "Internet privacy",
									snippet: "<span>Privacy</span> and data.",
								},
							],
						},
					}),
					{
						status: 200,
						headers: { "content-type": "application/json" },
					},
				),
		});
		expect(payload.provider).toBe("Wikipedia");
		expect(payload.results[0]).toMatchObject({
			title: "Internet privacy",
			url: "https://en.wikipedia.org/wiki/Internet_privacy",
			domain: "en.wikipedia.org",
			snippet: "Privacy and data.",
		});
	});

	it("creates an API-free extractive summary from result metadata", () => {
		const documents = documentsFromWebSearch(payload);
		const summary = buildExtractiveSummary(documents, "privacy search", 2);
		expect(summary).toHaveLength(2);
		expect(summary.join(" ").toLocaleLowerCase()).toContain("privacy");
	});

	it("reranks live hits locally and removes weak query mismatches", () => {
		const ranked = rankLiveResults(
			{
				query: "privacy search",
				provider: "DuckDuckGo",
				results: [
					...payload.results,
					{
						id: "weak",
						title: "General sports news",
						url: "https://sports.example/",
						domain: "sports.example",
						snippet: "Latest scores and schedules.",
						source: "DuckDuckGo",
						position: 4,
					},
				],
			},
			12,
		);
		expect(ranked.results.map((result) => result.title)).not.toContain(
			"General sports news",
		);
		expect(ranked.results[0]?.title).toBe("Privacy search guide");
	});

	it("ranks related live sources by shared text and domain overlap", () => {
		const documents = documentsFromWebSearch(payload);
		const related = rankRelatedDocuments(documents[0], documents);
		expect(related[0]?.document.id).toBe(documents[1].id);
		expect(related[0]?.overlap).toBeGreaterThan(0);
		expect(rankRelatedDocuments(documents[0], documents, 0)).toEqual([]);
	});

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
