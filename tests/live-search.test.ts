import { describe, expect, it } from "vitest";
import { buildInvestigationGraph } from "../src/graph/relationships";
import {
	buildAiSummary,
	buildExtractiveSummary,
	documentsFromWebSearch,
	indexWebSearch,
	isVerifiedOverviewSource,
	paginateWebSearch,
	rankLiveResults,
	rankRelatedDocuments,
	searchWikipedia,
	sourceReliabilitySignal,
} from "../src/search/live";
import { cleanDisplayText } from "../src/search/tokenizer";
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
	it("cleans markup, entities, and invisible formatting from display text", () => {
		expect(cleanDisplayText("• <b>Privacy</b>&nbsp;search\u200b")).toBe(
			"Privacy search",
		);
		expect(cleanDisplayText("&quot;Hi&quot; &amp; HI&#039;")).toBe(
			'"Hi" & HI\'',
		);
	});

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
							pages: {
								123: {
									pageid: 123,
									title: "Internet privacy",
									extract:
										"Privacy is the ability to control personal information.",
									thumbnail: {
										source: "https://upload.wikimedia.org/example.jpg",
									},
								},
							},
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
			image: "https://upload.wikimedia.org/example.jpg",
		});
	});

	it("creates an API-free extractive summary from result metadata", () => {
		const documents = documentsFromWebSearch(payload);
		const summary = buildExtractiveSummary(documents, "privacy search", 2);
		expect(summary).toHaveLength(2);
		expect(summary.join(" ").toLocaleLowerCase()).toContain("privacy");
	});

	it("keeps a disambiguation page to one representative summary point", () => {
		const documents = documentsFromWebSearch({
			...payload,
			results: [
				{
					...payload.results[0],
					snippet:
						"Hi or Hi may refer to: &quot;Hi&quot;, a song; Hi Records; Hi-Q games.",
				},
			],
		});
		const summary = buildExtractiveSummary(documents, "hi", 3);
		expect(summary).toHaveLength(1);
		expect(summary[0]).not.toContain("&quot;");
	});

	it("builds a local AI summary from the current result set", () => {
		const summary = buildAiSummary(
			documentsFromWebSearch(payload),
			"privacy search",
		);
		expect(summary?.intro).toContain("privacy");
	});

	it("allows official and reliable domains while rejecting social sources", () => {
		const amazon = documentsFromWebSearch({
			query: "amazon",
			provider: "DuckDuckGo",
			results: [
				{
					id: "amazon",
					title: "Amazon.com",
					url: "https://www.amazon.com/",
					domain: "www.amazon.com",
					snippet: "Shop for electronics, books, and more.",
					source: "DuckDuckGo",
					position: 1,
				},
				{
					id: "facebook",
					title: "Amazon on Facebook",
					url: "https://www.facebook.com/Amazon/",
					domain: "www.facebook.com",
					snippet: "Official social page.",
					source: "DuckDuckGo",
					position: 2,
				},
			],
		});
		expect(isVerifiedOverviewSource(amazon[0], "amazon")).toBe(true);
		expect(isVerifiedOverviewSource(amazon[1], "amazon")).toBe(false);
	});

	it("prefers reliable entity facts over entertainment episodes", () => {
		const mickeyPayload: WebSearchPayload = {
			query: "mickey mouse",
			provider: "DuckDuckGo",
			results: [
				{
					id: "episode",
					title: "Mickey Mouse Clubhouse Full Episodes Compilation",
					url: "https://www.youtube.com/watch?v=episode",
					domain: "www.youtube.com",
					snippet:
						"Mickey and friends solve problems in a series of play along episodes.",
					source: "DuckDuckGo",
					position: 1,
				},
				{
					id: "wiki",
					title: "Mickey Mouse - Wikipedia",
					url: "https://en.wikipedia.org/wiki/Mickey_Mouse",
					domain: "en.wikipedia.org",
					snippet:
						"Mickey Mouse is an animated cartoon character co-created in 1928 by Walt Disney and Ub Iwerks.",
					source: "DuckDuckGo",
					position: 2,
				},
				{
					id: "britannica",
					title: "Mickey Mouse | Cartoon, Creation, Disney",
					url: "https://www.britannica.com/topic/Mickey-Mouse",
					domain: "www.britannica.com",
					snippet:
						"Mickey Mouse is a cartoon character created by Walt Disney and Ub Iwerks.",
					source: "DuckDuckGo",
					position: 3,
				},
			],
		};
		const summary = buildAiSummary(
			documentsFromWebSearch(mickeyPayload),
			"mickey mouse",
		);
		expect(summary?.intro).toContain("co-created");
		expect(summary?.intro).not.toContain("episodes");
		expect(summary?.intro).not.toContain("Compilation");
	});

	it("removes social metrics and citation noise from entity summaries", () => {
		const bhuvanPayload: WebSearchPayload = {
			query: "bhuvan bam",
			provider: "DuckDuckGo",
			results: [
				{
					id: "instagram",
					title: "Bhuvan Bam (@bhuvan.bam)",
					url: "https://www.instagram.com/bhuvan.bam/",
					domain: "www.instagram.com",
					snippet:
						"21M Followers, 313 Following, 1,723 Posts - Bhuvan Bam (@bhuvan.bam)",
					source: "DuckDuckGo",
					position: 1,
				},
				{
					id: "wiki",
					title: "Bhuvan Bam - Wikipedia",
					url: "https://en.wikipedia.org/wiki/Bhuvan_Bam",
					domain: "en.wikipedia.org",
					snippet:
						"Bhuvan Avnindra Shankar Bam (pronounced [ˈbʱʊʋən baːm]; born 22 January 1994) [1][2] is an Indian comedian.",
					source: "DuckDuckGo",
					position: 2,
				},
			],
		};
		const summary = buildAiSummary(
			documentsFromWebSearch(bhuvanPayload),
			"Bhuvan Bam",
		);
		expect(summary?.intro).toContain("Indian comedian");
		expect(summary?.intro).not.toContain("Followers");
		expect(summary?.intro).not.toContain("[1]");
		expect(summary?.intro).not.toContain("pronounced");
	});

	it("prefers an entertainment profile over biography and gossip SEO", () => {
		const ashishPayload: WebSearchPayload = {
			query: "ashish chanchlani",
			provider: "DuckDuckGo",
			results: [
				{
					id: "gossip",
					title:
						"Before Arshdeep Singh, Was Samreen Kaur Dating Ashish Chanchlani?",
					url: "https://www.newsx.com/entertainment/dating",
					domain: "www.newsx.com",
					snippet:
						"Before getting engaged to Arshdeep Singh, Samreen Kaur was linked to Ashish Chanchlani.",
					source: "DuckDuckGo",
					position: 1,
				},
				{
					id: "seo",
					title: "Ashish Chanchlani Biography, Age, Girlfriend, Net Worth",
					url: "https://leaderbiography.com/ashish-chanchlani/",
					domain: "leaderbiography.com",
					snippet:
						"Ashish Chanchlani biography, age, girlfriend, family, career, YouTube, net worth.",
					source: "DuckDuckGo",
					position: 2,
				},
				{
					id: "imdb",
					title: "Ashish Chanchlani - IMDb",
					url: "https://www.imdb.com/name/nm9163913/",
					domain: "www.imdb.com",
					snippet:
						"Ashish Chanchlani is an Indian comedian, actor, writer, and director best known for creating Ashish Chanchlani Vines.",
					source: "DuckDuckGo",
					position: 3,
				},
			],
		};
		const summary = buildAiSummary(
			documentsFromWebSearch(ashishPayload),
			"ashish chanchlani",
		);
		expect(summary?.intro).toContain("Indian comedian");
		expect(summary?.intro).not.toContain("dating");
		expect(summary?.intro).not.toContain("girlfriend");
		expect(summary?.intro).not.toContain("net worth");
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

	it("adds only a small reliability signal to trusted domain types", () => {
		expect(sourceReliabilitySignal("agency.gov")).toBeGreaterThan(
			sourceReliabilitySignal("example.com"),
		);
		expect(sourceReliabilitySignal("example.com")).toBe(0);
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
