import { describe, expect, it } from "vitest";
import { buildIndex, deduplicateDocuments } from "../src/search/index";
import { parseQuery } from "../src/search/query";
import { levenshteinDistance, searchIndex } from "../src/search/ranking";
import { normalizeText, tokenize } from "../src/search/tokenizer";
import type { DocumentRecord } from "../src/search/types";
import { normalizeUrl } from "../src/search/url";

const documents: DocumentRecord[] = [
	{
		id: "one",
		title: "Satellite climate observations",
		url: "https://data.example.org/climate?utm_source=test",
		description: "Climate records from NASA",
		content: "Satellite data measures ocean and atmosphere change.",
		category: "Climate",
		published: "2025-01-01",
		source: "Example",
		entities: ["NASA", "satellite imagery"],
	},
	{
		id: "two",
		title: "Weather station records",
		url: "https://weather.example.net/stations",
		description: "Historical temperature records",
		content: "Station observations include daily temperature and rain.",
		category: "Weather",
		published: "2024-01-01",
		source: "Example",
		entities: ["weather stations"],
	},
	{
		id: "three",
		title: "Ocean climate archive",
		url: "https://archive.example.org/ocean",
		description: "An ocean archive",
		content: "Climate observations compare the ocean with satellite imagery.",
		category: "Climate",
		published: "2023-01-01",
		source: "Example",
		entities: ["NASA", "satellite imagery"],
	},
];

describe("text normalization", () => {
	it("normalizes accents, case, and punctuation", () => {
		expect(normalizeText("  ÉCOLOGY—Data / Maps ")).toBe("ecology data maps");
	});

	it("tokenizes and removes common stop words", () => {
		expect(tokenize("The climate data is from NASA")).toEqual([
			"climate",
			"data",
			"nasa",
		]);
		expect(tokenize("the climate", false)).toEqual(["the", "climate"]);
	});
});

describe("query parsing and URL normalization", () => {
	it("parses phrases, exclusions, domains, and URL constraints", () => {
		expect(
			parseQuery('"climate data" site:example.org url:ocean -weather'),
		).toEqual({
			terms: ["climate", "data"],
			phrases: ["climate data"],
			excludedTerms: ["weather"],
			domain: "example.org",
			url: "ocean",
		});
	});

	it("canonicalizes hosts, tracking parameters, fragments, and parameter order", () => {
		expect(
			normalizeUrl("HTTPS://Example.org:443/a/?utm_source=x&b=2&a=1#top"),
		).toBe("https://example.org/a?a=1&b=2");
	});

	it("rejects non-web URL schemes", () => {
		expect(() => normalizeUrl("javascript:alert(1)")).toThrow(TypeError);
	});
});

describe("local retrieval", () => {
	const index = buildIndex(documents);

	it("treats the UI all-domain selection as no domain constraint", () => {
		expect(
			searchIndex(index, "", { category: "all", domain: "all" }).total,
		).toBe(3);
		expect(
			searchIndex(index, "climate", { category: "all", domain: "all" }).total,
		).toBe(2);
	});

	it("ranks title matches above weaker body matches deterministically", () => {
		const first = searchIndex(index, "satellite climate").results.map(
			({ document }) => document.id,
		);
		const second = searchIndex(index, "satellite climate").results.map(
			({ document }) => document.id,
		);
		expect(first).toEqual(second);
		expect(first[0]).toBe("one");
	});

	it("matches quoted phrases and applies site, URL, exclusion, and category filters", () => {
		expect(
			searchIndex(index, '"climate observations" site:example.org').results.map(
				({ document }) => document.id,
			),
		).toEqual(["one", "three"]);
		expect(searchIndex(index, "climate -satellite").total).toBe(0);
		expect(
			searchIndex(index, "climate", { category: "Climate" }).results.map(
				({ document }) => document.id,
			),
		).toEqual(["one", "three"]);
		expect(
			searchIndex(index, "url:ocean").results.map(
				({ document }) => document.id,
			),
		).toEqual(["three"]);
		expect(
			searchIndex(index, '"weather stations"').results.map(
				({ document }) => document.id,
			),
		).toEqual(["two"]);
	});

	it("corrects a bounded typo and paginates", () => {
		expect(searchIndex(index, "satallite").results[0]?.document.id).toBe("one");
		expect(
			searchIndex(index, "climate", { pageSize: 1, page: 2 }).results,
		).toHaveLength(1);
		expect(levenshteinDistance("satallite", "satellite")).toBe(1);
	});

	it("deduplicates canonical URLs and validates stable output", () => {
		const duplicate = {
			...documents[0],
			id: "duplicate",
			url: "https://data.example.org/climate#section",
		};
		expect(deduplicateDocuments([documents[0], duplicate])).toHaveLength(1);
		expect(buildIndex([]).averageDocumentLength).toBe(0);
	});

	it("uses deterministic date and title sorting", () => {
		expect(
			searchIndex(index, "", { sort: "newest" }).results[0]?.document.id,
		).toBe("one");
		expect(
			searchIndex(index, "", { sort: "title" }).results[0]?.document.id,
		).toBe("three");
	});
});
