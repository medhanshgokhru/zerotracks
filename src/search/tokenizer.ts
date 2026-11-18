const STOP_WORDS = new Set(
	"a an and are as at be by for from has have in into is it its of on or that the their this to was were with".split(
		" ",
	),
);

export function normalizeText(value: string): string {
	return value
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLocaleLowerCase("en-US")
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim()
		.replace(/\s+/g, " ");
}

export function tokenize(value: string, removeStopWords = true): string[] {
	const tokens = normalizeText(value).match(/[\p{L}\p{N}]+/gu) ?? [];
	return removeStopWords
		? tokens.filter((token) => !STOP_WORDS.has(token))
		: tokens;
}
