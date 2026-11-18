import { documentDomain, searchableText } from "../search/index";
import { tokenize } from "../search/tokenizer";
import type {
	DocumentRecord,
	InvestigationGraph,
	SearchIndex,
} from "../search/types";

type RelatedDocument = {
	document: DocumentRecord;
	sharedEntities: string[];
	sameDomain: boolean;
	sharedTerms: number;
	score: number;
};

function relatedDocuments(
	index: SearchIndex,
	root: DocumentRecord,
): RelatedDocument[] {
	const rootTerms = new Set(tokenize(searchableText(root)));
	const rootDomain = documentDomain(root);
	return index.documents
		.filter((document) => document.id !== root.id)
		.map((document) => {
			const sharedEntities = root.entities.filter((entity) =>
				document.entities.some(
					(candidate) =>
						candidate.toLocaleLowerCase("en-US") ===
						entity.toLocaleLowerCase("en-US"),
				),
			);
			const sameDomain = documentDomain(document) === rootDomain;
			const sharedTerms = tokenize(searchableText(document)).filter((term) =>
				rootTerms.has(term),
			).length;
			const score =
				sharedEntities.length * 4 +
				(sameDomain ? 2 : 0) +
				Math.min(sharedTerms, 5) * 0.2;
			return { document, sharedEntities, sameDomain, sharedTerms, score };
		})
		.filter((item) => item.score > 0)
		.sort(
			(left, right) =>
				right.score - left.score ||
				left.document.title.localeCompare(right.document.title),
		);
}

export function buildInvestigationGraph(
	index: SearchIndex,
	documentId: string,
	limit = 6,
): InvestigationGraph {
	const root = index.documents.find((document) => document.id === documentId);
	if (!root) return { nodes: [], edges: [] };

	const related = relatedDocuments(index, root).slice(0, Math.max(0, limit));
	const nodes: InvestigationGraph["nodes"] = [
		{
			id: `doc:${root.id}`,
			label: root.title,
			type: "document",
			documentId: root.id,
		},
	];
	const edges: InvestigationGraph["edges"] = [];
	const rootDomainId = `domain:${documentDomain(root)}`;
	nodes.push({ id: rootDomainId, label: documentDomain(root), type: "domain" });
	edges.push({
		source: `doc:${root.id}`,
		target: rootDomainId,
		label: "published on",
	});

	for (const entity of [...new Set(root.entities)].sort((left, right) =>
		left.localeCompare(right),
	)) {
		const entityId = `entity:${entity.toLocaleLowerCase("en-US")}`;
		nodes.push({ id: entityId, label: entity, type: "entity" });
		edges.push({
			source: `doc:${root.id}`,
			target: entityId,
			label: "mentions",
		});
	}

	for (const item of related) {
		const relatedId = `doc:${item.document.id}`;
		nodes.push({
			id: relatedId,
			label: item.document.title,
			type: "document",
			documentId: item.document.id,
		});
		let hasFacetEdge = false;
		if (item.sameDomain) {
			edges.push({
				source: relatedId,
				target: rootDomainId,
				label: "published on",
			});
			hasFacetEdge = true;
		}
		for (const entity of item.sharedEntities) {
			edges.push({
				source: relatedId,
				target: `entity:${entity.toLocaleLowerCase("en-US")}`,
				label: "mentions",
			});
			hasFacetEdge = true;
		}
		if (!hasFacetEdge)
			edges.push({
				source: `doc:${root.id}`,
				target: relatedId,
				label: `${item.sharedTerms} shared terms`,
			});
	}

	return { nodes, edges };
}

export function traverseGraph(
	graph: InvestigationGraph,
	startId: string,
	depth = 2,
): string[] {
	if (!graph.nodes.some((node) => node.id === startId)) return [];
	const visited = new Set([startId]);
	let frontier = [startId];
	for (let level = 0; level < Math.max(0, depth); level += 1) {
		const next: string[] = [];
		for (const nodeId of frontier) {
			for (const edge of graph.edges) {
				const neighbor =
					edge.source === nodeId
						? edge.target
						: edge.target === nodeId
							? edge.source
							: "";
				if (neighbor && !visited.has(neighbor)) {
					visited.add(neighbor);
					next.push(neighbor);
				}
			}
		}
		frontier = next;
	}
	return [...visited];
}
