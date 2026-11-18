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

const STOP_WORDS = new Set(
	"a an and are as at be by for from has have in into is it its of on or that the their this to was were with".split(
		" ",
	),
);

function queryTerms(query) {
	return [
		...new Set(
			query
				.toLocaleLowerCase("en-US")
				.match(/[\p{L}\p{N}]+/gu)
				?.filter((term) => !STOP_WORDS.has(term) && term.length > 1) ?? [],
		),
	];
}

export function rankDuckDuckGoResults(results, query, limit = 12) {
	const terms = queryTerms(query);
	const domainCounts = new Map();
	const ranked = results
		.map((result, position) => {
			const title = result.title.toLocaleLowerCase("en-US");
			const snippet = result.snippet.toLocaleLowerCase("en-US");
			const domain = result.domain.toLocaleLowerCase("en-US");
			let score = 0;

			for (const term of terms) {
				if (title.includes(term)) score += 5;
				if (snippet.includes(term)) score += 3;
				if (domain.includes(term)) score += 1.5;
				const titleExact =
					title === term || title.split(/[^a-z0-9]+/u).includes(term);
				if (titleExact) score += 3;
			}

			if (result.title.length < 12) score -= 2;
			if (result.snippet.length < 35) score -= 1;
			if (
				/sponsored|advertisement|promo/i.test(
					`${result.title} ${result.snippet}`,
				)
			)
				score -= 8;
			if (/^(www\.)?(pinterest|facebook|tiktok|instagram)\./i.test(domain))
				score -= 2;

			score += Math.max(0, 2 - position * 0.08);
			return { result, score };
		})
		.sort(
			(left, right) =>
				right.score - left.score ||
				left.result.position - right.result.position,
		)
		.filter(({ result, score }) => {
			if (!terms.length) return score >= 0;
			const text = `${result.title} ${result.snippet}`.toLocaleLowerCase(
				"en-US",
			);
			return terms.some((term) => text.includes(term));
		})
		.map(({ result, score }) => {
			const repeats = domainCounts.get(result.domain) ?? 0;
			domainCounts.set(result.domain, repeats + 1);
			return { result, score: score - repeats * 0.75 };
		})
		.sort(
			(left, right) =>
				right.score - left.score ||
				left.result.position - right.result.position,
		)
		.map(({ result }) => result)
		.slice(0, Math.max(0, limit))
		.map((result, index) => ({ ...result, position: index + 1 }));

	return ranked;
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
