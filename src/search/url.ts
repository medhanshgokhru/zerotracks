const TRACKING_PARAMETERS = /^(utm_.+|fbclid|gclid|mc_cid|mc_eid|ref_src)$/i;

export function normalizeUrl(value: string): string {
	const url = new URL(value.trim());
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new TypeError("Only HTTP and HTTPS document URLs are supported.");
	}

	url.hash = "";
	url.hostname = url.hostname.toLocaleLowerCase("en-US");
	if (
		(url.protocol === "http:" && url.port === "80") ||
		(url.protocol === "https:" && url.port === "443")
	) {
		url.port = "";
	}

	const parameters = [...url.searchParams.entries()]
		.filter(([key]) => !TRACKING_PARAMETERS.test(key))
		.sort(([leftKey, leftValue], [rightKey, rightValue]) => {
			return (
				leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue)
			);
		});
	url.search = "";
	for (const [key, parameterValue] of parameters) {
		url.searchParams.append(key, parameterValue);
	}

	if (url.pathname.length > 1) {
		url.pathname = url.pathname.replace(/\/+$/, "");
	}
	return url.toString();
}

export function domainOf(value: string): string {
	return new URL(value).hostname.toLocaleLowerCase("en-US");
}

export function isValidExternalUrl(value: string): boolean {
	try {
		const parsed = new URL(value);
		return parsed.protocol === "https:" || parsed.protocol === "http:";
	} catch {
		return false;
	}
}
