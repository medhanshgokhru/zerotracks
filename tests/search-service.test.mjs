import { afterEach, describe, expect, it } from "vitest";
import {
	extractOpenGraphImage,
	extractYouTubeThumbnail,
	parseDuckDuckGoHtml,
	rankDuckDuckGoResults,
	unwrapResultUrl,
} from "../server/duckduckgo.mjs";
import { createSearchService } from "../server/index.mjs";

const html = `
<div class="result">
  <h2><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fone%3Futm_source%3Dsearch%23top&amp;rut=private">Example One</a></h2>
  <img class="result__icon__img" src="//external-content.duckduckgo.com/ip3/example.org.ico" />
  <a class="result__snippet">A useful <b>search</b> result.</a>
</div>
<div class="result">
  <h2><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Ftwo&amp;rut=private">Example Two</a></h2>
  <a class="result__snippet">Another result.</a>
</div>`;

const servers = new Set();

afterEach(async () => {
	await Promise.all(
		[...servers].map(
			(server) => new Promise((resolve) => server.close(resolve)),
		),
	);
	servers.clear();
});

describe("DuckDuckGo result parsing", () => {
	it("derives YouTube thumbnails and Open Graph preview images", () => {
		expect(
			extractYouTubeThumbnail("https://www.youtube.com/watch?v=o_YV7lSEbO0"),
		).toBe("https://i.ytimg.com/vi/o_YV7lSEbO0/hqdefault.jpg");
		expect(
			extractOpenGraphImage(
				'<meta property="og:image" content="/images/preview.jpg">',
				"https://example.org/page",
			),
		).toBe("https://example.org/images/preview.jpg");
	});

	it("unwraps provider redirects and rejects unsafe URL schemes", () => {
		expect(
			unwrapResultUrl(
				"//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fpage&amp;rut=ignored",
			),
		).toBe("https://example.org/page");
		expect(
			unwrapResultUrl(
				"//duckduckgo.com/l/?uddg=javascript%3Aalert(1)&amp;rut=ignored",
			),
		).toBe("");
	});

	it("extracts safe result metadata, strips trackers, and deduplicates URLs", () => {
		const results = parseDuckDuckGoHtml(`${html}${html}`);
		expect(results).toHaveLength(2);
		expect(results[0]).toMatchObject({
			title: "Example One",
			url: "https://example.org/one",
			domain: "example.org",
			snippet: "A useful search result.",
			image: "",
		});
	});

	it("ranks relevant DuckDuckGo hits ahead of weak matches", () => {
		const results = rankDuckDuckGoResults(
			[
				{
					id: "weak",
					title: "Unrelated page",
					url: "https://weak.example/",
					domain: "weak.example",
					snippet: "General information.",
					source: "DuckDuckGo",
					position: 1,
				},
				{
					id: "strong",
					title: "Climate data guide",
					url: "https://climate.example/",
					domain: "climate.example",
					snippet: "Climate data for ocean temperature research.",
					source: "DuckDuckGo",
					position: 2,
				},
			],
			"climate data",
			12,
		);
		expect(results.map((result) => result.id)).toEqual(["strong"]);
	});

	it("prioritizes the official domain for ambiguous brand searches", () => {
		const results = rankDuckDuckGoResults(
			[
				{
					id: "wikipedia",
					title: "Amazon - Wikipedia",
					url: "https://en.wikipedia.org/wiki/Amazon",
					domain: "en.wikipedia.org",
					snippet: "Amazon may refer to several topics.",
					source: "DuckDuckGo",
					position: 1,
				},
				{
					id: "facebook",
					title: "Amazon - Facebook",
					url: "https://www.facebook.com/Amazon/",
					domain: "www.facebook.com",
					snippet: "Official Amazon social page.",
					source: "DuckDuckGo",
					position: 2,
				},
				{
					id: "amazon",
					title: "Amazon.com",
					url: "https://www.amazon.com/",
					domain: "www.amazon.com",
					snippet: "Shop for electronics, books, and more.",
					source: "DuckDuckGo",
					position: 3,
				},
			],
			"amazon",
			12,
		);
		expect(results[0].id).toBe("amazon");
	});

	it("builds a live overview for arbitrary queries", async () => {
		const server = createSearchService({
			search: async () => [],
		});
		servers.add(server);
		await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
		const address = server.address();
		if (!address || typeof address === "string")
			throw new Error("No test server address.");
		const response = await fetch(
			`http://127.0.0.1:${address.port}/api/overview`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					query: "quantum computing",
					results: [
						{
							id: "one",
							title: "Quantum computing overview",
							domain: "example.org",
							snippet:
								"Quantum computing uses quantum mechanics to process information.",
							url: "https://example.org/quantum",
							source: "DuckDuckGo",
							position: 1,
						},
					],
				}),
			},
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			model: "live-result-synthesis",
			sourceIds: ["one"],
		});
	});

	it("returns stateless, no-store results and rejects invalid or disallowed requests", async () => {
		const server = createSearchService({
			allowedOrigins: ["https://search.example"],
			maxRequestsPerMinute: 1,
			search: async (query) => [
				{
					id: query,
					title: "Private search result",
					url: "https://example.org/",
					domain: "example.org",
					snippet: "A private query search result.",
					source: "Test",
					position: 1,
				},
			],
		});
		servers.add(server);
		await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
		const address = server.address();
		if (!address || typeof address === "string")
			throw new Error("No test server address.");
		const base = `http://127.0.0.1:${address.port}`;

		const response = await fetch(`${base}/api/search`, {
			method: "POST",
			headers: {
				origin: "https://search.example",
				"content-type": "application/json",
			},
			body: JSON.stringify({ query: "private query" }),
		});
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(response.headers.get("access-control-allow-origin")).toBe(
			"https://search.example",
		);
		expect(await response.json()).toMatchObject({
			query: "private query",
			results: [{ title: "Private search result" }],
		});
		const limited = await fetch(`${base}/api/search`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ query: "second query" }),
		});
		expect(limited.status).toBe(429);

		const invalid = await fetch(`${base}/api/search`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ query: " " }),
		});
		expect(invalid.status).toBe(400);
		const denied = await fetch(`${base}/api/search`, {
			method: "POST",
			headers: {
				origin: "https://other.example",
				"content-type": "application/json",
			},
			body: JSON.stringify({ query: "test" }),
		});
		expect(denied.status).toBe(403);
	});

	it("falls back to a safe rate limit for invalid configuration", async () => {
		const server = createSearchService({
			maxRequestsPerMinute: "not-a-number",
			search: async () => [],
		});
		servers.add(server);
		await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
		const address = server.address();
		if (!address || typeof address === "string")
			throw new Error("No test server address.");
		const response = await fetch(
			`http://127.0.0.1:${address.port}/api/search`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ query: "safe" }),
			},
		);
		expect(response.status).toBe(200);
	});
});
