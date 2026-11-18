export type DocumentRecord = {
	id: string;
	title: string;
	url: string;
	description: string;
	content: string;
	category: string;
	published: string;
	source: string;
	entities: string[];
};

export type Posting = {
	id: string;
	titleTf: number;
	descriptionTf: number;
	bodyTf: number;
	documentLength: number;
};

export type SearchIndex = {
	version: number;
	documents: DocumentRecord[];
	postings: Record<string, Posting[]>;
	documentFrequency: Record<string, number>;
	vocabulary: string[];
	averageDocumentLength: number;
};

export type ParsedQuery = {
	terms: string[];
	phrases: string[];
	excludedTerms: string[];
	domain: string;
	url: string;
};

export type SearchOptions = {
	category?: string;
	domain?: string;
	sort?: "relevance" | "newest" | "title";
	page?: number;
	pageSize?: number;
	fuzzy?: boolean;
};

export type SearchResult = {
	document: DocumentRecord;
	score: number;
};

export type SearchResponse = {
	results: SearchResult[];
	total: number;
	page: number;
	pageSize: number;
	suggestions: string[];
};

export type WebSearchHit = {
	id: string;
	title: string;
	url: string;
	domain: string;
	snippet: string;
	source: string;
	position: number;
};

export type WebSearchPayload = {
	query: string;
	provider: string;
	results: WebSearchHit[];
};

export type GraphNode = {
	id: string;
	label: string;
	type: "document" | "domain" | "entity";
	documentId?: string;
};

export type GraphEdge = {
	source: string;
	target: string;
	label: string;
};

export type InvestigationGraph = {
	nodes: GraphNode[];
	edges: GraphEdge[];
};
