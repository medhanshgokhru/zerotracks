import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import {
	ProviderUnavailableError,
	rankDuckDuckGoResults,
	searchDuckDuckGo,
} from "./duckduckgo.mjs";

const DEFAULT_ORIGINS = [
	"http://localhost:5173",
	"http://127.0.0.1:5173",
	"http://localhost:4173",
	"http://127.0.0.1:4173",
];
const MAX_QUERY_LENGTH = 256;
const MAX_RESULTS = 20;
const MAX_BODY_LENGTH = 4096;

function buildLiveOverview(query, results) {
	const terms = [
		...new Set(
			query
				.toLocaleLowerCase("en-US")
				.match(/[\p{L}\p{N}]+/gu)
				?.filter((term) => term.length > 1) ?? [],
		),
	];
	const snippets = results
		.map((result) => {
			const text = `${result.title}. ${result.snippet}`
				.replace(/<[^>]*>/g, " ")
				.replace(/&(?:nbsp|amp|quot|apos|#39);/gi, " ")
				.replace(/\s+/g, " ")
				.trim();
			const sentence =
				text.match(/^.{35}[^.!?]*[.!?]/)?.[0]?.trim() ||
				text.split(/(?<=[.!?])\s+/)[0]?.trim() ||
				text;
			const score = terms.reduce(
				(total, term) =>
					total + (sentence.toLocaleLowerCase("en-US").includes(term) ? 2 : 0),
				0,
			);
			return { sentence, score, position: result.position };
		})
		.filter(({ sentence }) => sentence.length >= 35)
		.sort(
			(left, right) =>
				right.score - left.score || left.position - right.position,
		);
	const seen = new Set();
	const selected = [];
	for (const snippet of snippets) {
		const key = snippet.sentence
			.toLocaleLowerCase("en-US")
			.replace(/[^a-z0-9]+/g, " ")
			.trim();
		if (!key || seen.has(key)) continue;
		seen.add(key);
		selected.push(snippet.sentence.replace(/[.!?]+$/, "."));
		if (selected.length === 3) break;
	}
	return {
		overview:
			selected.join(" ") || `No verified summary is available for ${query}.`,
		keyPoints: selected.slice(0, 3),
		sourceIds: results.slice(0, 3).map((result) => result.id),
		model: "live-result-synthesis",
	};
}

function positiveInteger(value, fallback) {
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function sendJson(response, status, body) {
	response.writeHead(status, {
		"cache-control": "no-store",
		"content-type": "application/json; charset=utf-8",
		"referrer-policy": "no-referrer",
		"x-content-type-options": "nosniff",
	});
	response.end(JSON.stringify(body));
}

async function readJsonBody(request) {
	let body = "";
	for await (const chunk of request) {
		body += chunk;
		if (Buffer.byteLength(body) > MAX_BODY_LENGTH) {
			const error = new Error("Request body is too large.");
			error.statusCode = 413;
			throw error;
		}
	}
	try {
		return JSON.parse(body);
	} catch {
		const error = new Error("Invalid JSON request body.");
		error.statusCode = 400;
		throw error;
	}
}

export function createSearchService(options = {}) {
	const search = options.search ?? searchDuckDuckGo;
	const maxRequestsPerMinute = positiveInteger(
		options.maxRequestsPerMinute ?? process.env.MAX_SEARCHES_PER_MINUTE ?? 60,
		60,
	);
	let rateWindowStart = Date.now();
	let requestsInWindow = 0;
	const allowedOrigins = new Set(
		options.allowedOrigins ??
			(process.env.ALLOWED_ORIGINS
				? process.env.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim())
				: DEFAULT_ORIGINS),
	);

	return createServer(async (request, response) => {
		const origin = request.headers.origin;
		if (origin && !allowedOrigins.has(origin)) {
			sendJson(response, 403, { error: "This app origin is not allowed." });
			return;
		}
		if (origin) {
			response.setHeader("access-control-allow-origin", origin);
			response.setHeader("vary", "Origin");
		}
		if (request.method === "OPTIONS") {
			response.writeHead(204, {
				"access-control-allow-headers": "content-type",
				"access-control-allow-methods": "POST, OPTIONS",
				"cache-control": "no-store",
				"referrer-policy": "no-referrer",
			});
			response.end();
			return;
		}

		const requestUrl = new URL(request.url ?? "/", "http://localhost");
		if (request.method === "GET" && requestUrl.pathname === "/healthz") {
			sendJson(response, 200, { status: "ok" });
			return;
		}
		let body;
		try {
			body = await readJsonBody(request);
		} catch (error) {
			sendJson(response, error.statusCode ?? 400, { error: error.message });
			return;
		}
		const query = typeof body?.query === "string" ? body.query.trim() : "";
		if (
			!query ||
			query.length > MAX_QUERY_LENGTH ||
			/[\u0000-\u001f\u007f]/u.test(query)
		) {
			sendJson(response, 400, {
				error: `Enter a query between 1 and ${MAX_QUERY_LENGTH} characters.`,
			});
			return;
		}
		if (request.method === "POST" && requestUrl.pathname === "/api/overview") {
			const results = Array.isArray(body.results)
				? body.results.slice(0, 20)
				: [];
			sendJson(response, 200, buildLiveOverview(query, results));
			return;
		}
		if (request.method !== "POST" || requestUrl.pathname !== "/api/search") {
			sendJson(response, 404, { error: "Not found." });
			return;
		}
		if (Date.now() - rateWindowStart >= 60_000) {
			rateWindowStart = Date.now();
			requestsInWindow = 0;
		}
		if (requestsInWindow >= maxRequestsPerMinute) {
			response.setHeader("retry-after", "60");
			sendJson(response, 429, {
				error: "Search service is temporarily rate-limited.",
			});
			return;
		}
		requestsInWindow += 1;

		try {
			const results = await search(query, {
				signal: AbortSignal.timeout(10_000),
			});
			const rankedResults = rankDuckDuckGoResults(results, query);
			sendJson(response, 200, {
				query,
				provider: "DuckDuckGo",
				results: rankedResults.slice(0, MAX_RESULTS),
			});
		} catch (error) {
			const status = error instanceof ProviderUnavailableError ? 502 : 500;
			sendJson(response, status, {
				error:
					status === 502
						? "The search provider is temporarily unavailable."
						: "Search could not be completed.",
			});
		}
	});
}

export function startSearchService() {
	const port = Number(process.env.SEARCH_PORT ?? 8788);
	const host = process.env.SEARCH_HOST ?? "127.0.0.1";
	const server = createSearchService();
	server.listen(port, host, () => {
		console.log(
			`ZeroTracks search service listening on http://${host}:${port}`,
		);
	});
	return server;
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	startSearchService();
}
