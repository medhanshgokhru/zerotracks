import { afterEach, describe, expect, it } from "vitest";
import { parseDuckDuckGoHtml, unwrapResultUrl } from "../server/duckduckgo.mjs";
import { createSearchService } from "../server/index.mjs";

const html = `
<div class="result">
  <h2><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fone%3Futm_source%3Dsearch%23top&amp;rut=private">Example One</a></h2>
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
		});
	});

	it("returns stateless, no-store results and rejects invalid or disallowed requests", async () => {
		const server = createSearchService({
			allowedOrigins: ["https://search.example"],
			maxRequestsPerMinute: 1,
			search: async (query) => [
				{
					id: query,
					title: "Hit",
					url: "https://example.org/",
					domain: "example.org",
					snippet: "Snippet",
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
			results: [{ title: "Hit" }],
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
});
