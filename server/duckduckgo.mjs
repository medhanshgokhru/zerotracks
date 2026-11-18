import { load } from "cheerio";

const SEARCH_URL = "https://html.duckduckgo.com/html/";
const MAX_RESULTS = 20;
const TRACKING_PARAMETERS = /^(utm_.+|fbclid|gclid|mc_cid|mc_eid|ref_src)$/i;

export class ProviderUnavailableError extends Error {
	constructor(message = "The search provider is unavailable.") {
		super(message);
		this.name = "ProviderUnavailableError";
	}
}

export function unwrapResultUrl(value) {
	try {
		const parsed = new URL(value, SEARCH_URL);
		if (parsed.hostname === "duckduckgo.com" && parsed.pathname === "/l/") {
			const destination = parsed.searchParams.get("uddg");
			if (!destination) return "";
			return normalizeResultUrl(destination);
		}
		return normalizeResultUrl(parsed.href);
	} catch {
		return "";
	}
}

export function normalizeResultUrl(value) {
	try {
		const url = new URL(value);
		if (url.protocol !== "http:" && url.protocol !== "https:") return "";
		url.hash = "";
		for (const key of [...url.searchParams.keys()]) {
			if (TRACKING_PARAMETERS.test(key)) url.searchParams.delete(key);
		}
		return url.href;
	} catch {
		return "";
	}
}

export function parseDuckDuckGoHtml(html, limit = MAX_RESULTS) {
	const $ = load(html);
	const results = [];
	const seen = new Set();

	$(".result").each((_, element) => {
		if (results.length >= limit) return false;
		const result = $(element);
		const titleLink = result.find("a.result__a").first();
		const title = titleLink.text().replace(/\s+/g, " ").trim();
		const url = unwrapResultUrl(titleLink.attr("href") ?? "");
		const snippet = result
			.find(".result__snippet")
			.first()
			.text()
			.replace(/\s+/g, " ")
			.trim();

		if (!title || !url || seen.has(url)) return;
		seen.add(url);
		results.push({
			id: url,
			title,
			url,
			domain: new URL(url).hostname.toLocaleLowerCase("en-US"),
			snippet,
			source: "DuckDuckGo",
			position: results.length + 1,
		});
	});

	if (!results.length && $(".anomaly-modal, form[action*='anomaly']").length) {
		throw new ProviderUnavailableError(
			"The provider temporarily requires a browser challenge.",
		);
	}
	return results;
}

export async function searchDuckDuckGo(query, options = {}) {
	const fetchImpl = options.fetchImpl ?? fetch;
	const timeoutMs = options.timeoutMs ?? 10_000;
	const endpoint = new URL(SEARCH_URL);
	endpoint.searchParams.set("q", query);

	let response;
	try {
		response = await fetchImpl(endpoint, {
			headers: {
				accept: "text/html",
				"user-agent": "ZeroTracksSearch/1.0",
			},
			signal: options.signal ?? AbortSignal.timeout(timeoutMs),
		});
	} catch {
		throw new ProviderUnavailableError();
	}

	if (!response.ok) throw new ProviderUnavailableError();
	const contentType = response.headers.get("content-type") ?? "";
	if (!contentType.toLocaleLowerCase("en-US").includes("text/html")) {
		throw new ProviderUnavailableError();
	}

	const html = await response.text();
	return parseDuckDuckGoHtml(html);
}
