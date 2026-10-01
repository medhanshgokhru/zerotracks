import { normalizeText, tokenize } from "./tokenizer";
import type { ParsedQuery } from "./types";

export function parseQuery(input: string): ParsedQuery {
	const parsed: ParsedQuery = {
		terms: [],
		phrases: [],
		excludedTerms: [],
		domain: "",
		url: "",
	};
	const parts = input.matchAll(/"([^"]+)"|(\S+)/g);

	for (const part of parts) {
		if (part[1]) {
			const phrase = normalizeText(part[1]);
			if (phrase) parsed.phrases.push(phrase);
			parsed.terms.push(...tokenize(part[1]));
			continue;
		}

		const token = part[2] ?? "";
		const lowerToken = token.toLocaleLowerCase("en-US");
		if (lowerToken.startsWith("site:") || lowerToken.startsWith("domain:")) {
			parsed.domain = token
				.slice(token.indexOf(":") + 1)
				.toLocaleLowerCase("en-US")
				.replace(/^https?:\/\//, "")
				.replace(/\/$/, "");
		} else if (lowerToken.startsWith("url:")) {
			parsed.url = normalizeText(token.slice(4));
		} else if (token.startsWith("-") && token.length > 1) {
			parsed.excludedTerms.push(...tokenize(token.slice(1)));
		} else {
			parsed.terms.push(...tokenize(token));
		}
	}

	return parsed;
}
