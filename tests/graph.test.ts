import { describe, expect, it } from "vitest";
import {
	buildInvestigationGraph,
	traverseGraph,
} from "../src/graph/relationships";
import { buildIndex } from "../src/search/index";
import type { DocumentRecord } from "../src/search/types";

const records: DocumentRecord[] = [
	{
		id: "a",
		title: "Climate observations",
		url: "https://data.example.org/climate",
		description: "Satellite climate data",
		content: "Observations from the climate archive.",
		category: "Climate",
		published: "2025-01-01",
		source: "Source",
		entities: ["NASA", "Climate data"],
	},
	{
		id: "b",
		title: "Satellite records",
		url: "https://archive.example.net/records",
		description: "Records from NASA",
		content: "Climate data from satellite observations.",
		category: "Research",
		published: "2024-01-01",
		source: "Source",
		entities: ["NASA", "Climate data"],
	},
	{
		id: "c",
		title: "Unrelated records",
		url: "https://other.example.net/records",
		description: "Local transit routes",
		content: "Schedules and stops for a city bus network.",
		category: "Transport",
		published: "2023-01-01",
		source: "Source",
		entities: ["Transit"],
	},
];

describe("investigation relationships", () => {
	it("builds repeatable domain, entity, and related-document edges", () => {
		const index = buildIndex(records);
		const first = buildInvestigationGraph(index, "a");
		expect(first).toEqual(buildInvestigationGraph(index, "a"));
		expect(first.nodes.map((node) => node.id)).toContain("entity:nasa");
		expect(
			first.nodes.map((node) => node.documentId).filter(Boolean),
		).toContain("b");
		expect(
			first.nodes.map((node) => node.documentId).filter(Boolean),
		).not.toContain("c");
	});

	it("traverses graph relationships to a bounded depth", () => {
		const graph = buildInvestigationGraph(buildIndex(records), "a");
		const visited = traverseGraph(graph, "doc:a", 2);
		expect(visited).toContain("doc:a");
		expect(visited).toContain("entity:nasa");
		expect(traverseGraph(graph, "missing")).toEqual([]);
	});
});
