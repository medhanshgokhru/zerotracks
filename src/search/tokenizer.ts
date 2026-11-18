const STOP_WORDS = new Set(
	"a an and are as at be by for from has have in into is it its of on or that the their this to was were with".split(
		" ",
	),
);

const HTML_ENTITIES: Record<string, string> = {
	amp: "&",
	apos: "'",
	gt: ">",
	lt: "<",
	nbsp: " ",
	quot: '"',
};

export function cleanDisplayText(value: string): string {
	let decoded = value.replace(/<[^>]*>/g, " ");
	for (let pass = 0; pass < 2; pass += 1) {
		decoded = decoded.replace(
			/&(#x?[0-9a-f]+|[a-z][a-z0-9]+);/gi,
			(entity, name: string) => {
				if (name[0]?.toLocaleLowerCase("en-US") === "#") {
					const code =
						name[1]?.toLocaleLowerCase("en-US") === "x"
							? Number.parseInt(name.slice(2), 16)
							: Number.parseInt(name.slice(1), 10);
					return code >= 0 && code <= 0x10ffff
						? String.fromCodePoint(code)
						: " ";
				}
				return HTML_ENTITIES[name.toLocaleLowerCase("en-US")] ?? entity;
			},
		);
	}
	return decoded
		.split("")
		.filter((character) => {
			const code = character.codePointAt(0) ?? 0;
			return !(
				(code >= 0 && code <= 0x1f) ||
				code === 0x7f ||
				(code >= 0x200b && code <= 0x200f) ||
				(code >= 0x202a && code <= 0x202e) ||
				code === 0xfeff
			);
		})
		.join("")
		.replace(/^[\s•·▪◦▸►→|]+|[\s|]+$/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

export function normalizeText(value: string): string {
	return (value ? cleanDisplayText(value) : "")
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
