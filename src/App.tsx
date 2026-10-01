import {
	ArrowLeft,
	ArrowRight,
	ArrowUpRight,
	Search,
	Shield,
	X,
} from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { documentDomain } from "./search/index";
import { paginateWebSearch } from "./search/live";
import { getLocalSuggestions, searchIndex } from "./search/ranking";
import type {
	DocumentRecord,
	SearchIndex,
	WebSearchPayload,
} from "./search/types";
import { isValidExternalUrl } from "./search/url";

const SEARCH_API_BASE =
	import.meta.env.VITE_SEARCH_API_URL?.trim().replace(/\/+$/, "") ||
	(import.meta.env.DEV ? "/api" : "");
const ConnectedField = lazy(() => import("./components/ConnectedField"));

type LiveSearchState = {
	query: string;
	status: "idle" | "loading" | "ready" | "error";
	payload?: WebSearchPayload;
	error?: string;
};

type BrowserEntry = {
	url: string;
	title: string;
};

function CompactResult({
	document,
	position,
	selected,
	onClick,
}: {
	document: DocumentRecord;
	position: number;
	selected: boolean;
	onClick: () => void;
}) {
	return (
		<button
			className={`orbit-result${selected ? " is-selected" : ""}`}
			type="button"
			onClick={onClick}
			aria-pressed={selected}
		>
			<span className="orbit-position">
				{String(position).padStart(2, "0")}
			</span>
			<span className="orbit-copy">
				<strong>{document.title}</strong>
				<small>{documentDomain(document)}</small>
			</span>
			<ArrowUpRight size={14} aria-hidden="true" />
		</button>
	);
}

export default function App() {
	const [index, setIndex] = useState<SearchIndex | null>(null);
	const [query, setQuery] = useState("");
	const [submittedQuery, setSubmittedQuery] = useState("");
	const [liveSearch, setLiveSearch] = useState<LiveSearchState>({
		query: "",
		status: "idle",
	});
	const [selectedId, setSelectedId] = useState("");
	const [detailClosed, setDetailClosed] = useState(false);
	const [domain, setDomain] = useState("all");
	const [browserEntry, setBrowserEntry] = useState<BrowserEntry | null>(null);
	const [browserHistory, setBrowserHistory] = useState<BrowserEntry[]>([]);
	const [browserIndex, setBrowserIndex] = useState(-1);
	const searchRef = useRef<HTMLInputElement>(null);
	const addressRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		let active = true;
		fetch(`${import.meta.env.BASE_URL}data/search-index.json`, {
			cache: "no-store",
		})
			.then((response) => {
				if (!response.ok)
					throw new Error(`Index unavailable (${response.status}).`);
				return response.json() as Promise<SearchIndex>;
			})
			.then((loaded) => {
				if (active) setIndex(loaded);
			})
			.catch(() => undefined);
		if (import.meta.env.PROD && "serviceWorker" in navigator) {
			void navigator.serviceWorker
				.register(`${import.meta.env.BASE_URL}service-worker.js`)
				.catch(() => undefined);
		}
		return () => {
			active = false;
		};
	}, []);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			const editing =
				target?.isContentEditable ||
				["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "");
			if (
				(event.key === "/" && !editing) ||
				((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k")
			) {
				event.preventDefault();
				searchRef.current?.focus();
			} else if (event.key === "Escape") {
				if (browserEntry) setBrowserEntry(null);
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => {
			window.removeEventListener("keydown", onKeyDown);
		};
	}, [browserEntry]);

	useEffect(() => {
		if (!SEARCH_API_BASE || !submittedQuery) {
			setLiveSearch({ query: submittedQuery, status: "idle" });
			return;
		}
		const controller = new AbortController();
		setLiveSearch({ query: submittedQuery, status: "loading" });
		fetch(`${SEARCH_API_BASE}/search`, {
			method: "POST",
			signal: controller.signal,
			cache: "no-store",
			credentials: "omit",
			referrerPolicy: "no-referrer",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ query: submittedQuery }),
		})
			.then(async (response) => {
				const payload = (await response.json()) as WebSearchPayload & {
					error?: string;
				};
				if (!response.ok)
					throw new Error(payload.error || "Live search is unavailable.");
				return payload;
			})
			.then((payload) =>
				setLiveSearch({ query: submittedQuery, status: "ready", payload }),
			)
			.catch((error: unknown) => {
				if (!controller.signal.aborted) {
					setLiveSearch({
						query: submittedQuery,
						status: "error",
						error:
							error instanceof Error
								? error.message
								: "Live search is unavailable.",
					});
				}
			});
		return () => controller.abort();
	}, [submittedQuery]);

	const livePayload =
		liveSearch.query === submittedQuery && liveSearch.status === "ready"
			? liveSearch.payload
			: undefined;
	const localResults = useMemo(
		() =>
			index
				? searchIndex(index, submittedQuery, { domain, pageSize: 20 })
				: null,
		[index, submittedQuery, domain],
	);
	const liveResults = useMemo(
		() =>
			livePayload
				? paginateWebSearch(livePayload, { domain, pageSize: 20 })
				: null,
		[livePayload, domain],
	);
	const pending = Boolean(
		SEARCH_API_BASE &&
			submittedQuery &&
			(liveSearch.query !== submittedQuery || liveSearch.status === "loading"),
	);
	const liveFailed = Boolean(
		SEARCH_API_BASE &&
			submittedQuery &&
			liveSearch.query === submittedQuery &&
			liveSearch.status === "error",
	);
	const result = livePayload ? liveResults : localResults;
	const records = result?.results.map((item) => item.document) ?? [];
	const selected =
		records.find((item) => item.id === selectedId) ??
		(!detailClosed ? records[0] : undefined);
	const domains = useMemo(
		() => [...new Set(records.map(documentDomain))].sort(),
		[records],
	);
	const suggestions = useMemo(
		() => (index && !submittedQuery ? getLocalSuggestions(index, query) : []),
		[index, query, submittedQuery],
	);

	function submitSearch(event?: React.FormEvent<HTMLFormElement>) {
		event?.preventDefault();
		setSelectedId("");
		setDetailClosed(false);
		setBrowserEntry(null);
		setSubmittedQuery(query.trim());
	}

	function newSession() {
		setQuery("");
		setSubmittedQuery("");
		setSelectedId("");
		setDetailClosed(false);
		setDomain("all");
		setBrowserEntry(null);
		setBrowserHistory([]);
		setBrowserIndex(-1);
	}

	function openPage(entry: BrowserEntry) {
		if (!isValidExternalUrl(entry.url)) return;
		setBrowserEntry(entry);
		setBrowserHistory((current) => [
			...current.slice(0, browserIndex + 1),
			entry,
		]);
		setBrowserIndex((current) => current + 1);
	}

	function navigateAddress(event?: React.FormEvent<HTMLFormElement>) {
		event?.preventDefault();
		if (!browserEntry || !addressRef.current) return;
		let address = addressRef.current.value.trim();
		if (!address.includes("://")) address = `https://${address}`;
		if (isValidExternalUrl(address))
			openPage({ url: address, title: new URL(address).hostname });
	}

	function goBack() {
		if (browserIndex <= 0) return;
		const nextIndex = browserIndex - 1;
		setBrowserIndex(nextIndex);
		setBrowserEntry(browserHistory[nextIndex]);
	}

	function goForward() {
		if (browserIndex < 0 || browserIndex >= browserHistory.length - 1) return;
		const nextIndex = browserIndex + 1;
		setBrowserIndex(nextIndex);
		setBrowserEntry(browserHistory[nextIndex]);
	}

	return (
		<div className={`desktop-shell${browserEntry ? " browser-open" : ""}`}>
			<header className="deskbar">
				<button
					className="desk-brand"
					type="button"
					onClick={newSession}
					aria-label="New ZeroTracks session"
				>
					<span>zerotracks</span>
				</button>
			</header>

			<main className="search-deck">
				{browserEntry ? (
					<section className="source-view" aria-label="Source viewer">
						<div className="browser-bar">
							<button
								className="browser-icon"
								type="button"
								onClick={goBack}
								disabled={browserIndex <= 0}
								aria-label="Back"
								title="Back"
							>
								<ArrowLeft size={16} />
							</button>
							<button
								className="browser-icon"
								type="button"
								onClick={goForward}
								disabled={browserIndex >= browserHistory.length - 1}
								aria-label="Forward"
								title="Forward"
							>
								<ArrowRight size={16} />
							</button>
							<button
								className="browser-icon"
								type="button"
								onClick={() => setBrowserEntry(null)}
								aria-label="Return to results"
								title="Return to results"
							>
								<Search size={15} />
							</button>
							<form className="address-form" onSubmit={navigateAddress}>
								<Shield size={13} />
								<label className="visually-hidden" htmlFor="browser-address">
									Web address
								</label>
								<input
									id="browser-address"
									ref={addressRef}
									key={browserEntry.url}
									defaultValue={browserEntry.url}
									autoComplete="off"
									spellCheck={false}
								/>
								<button type="submit" aria-label="Go to address">
									<ArrowRight size={15} />
								</button>
							</form>
							<a
								className="browser-icon"
								href={browserEntry.url}
								target="_blank"
								rel="noopener noreferrer"
								referrerPolicy="no-referrer"
								aria-label="Open in system browser"
								title="Open in system browser"
							>
								<ArrowUpRight size={16} />
							</a>
						</div>
						<div className="frame-wrap">
							<div className="source-handoff">
								<Shield size={26} />
								<span className="source-handoff-kicker">SOURCE HANDOFF</span>
								<h2>{browserEntry.title}</h2>
								<p>
									This source controls whether it can be embedded. ZeroTracks
									will not fake a blank in-app browser page or bypass that
									policy.
								</p>
								<div className="source-address">{browserEntry.url}</div>
								<a
									className="source-open-button"
									href={browserEntry.url}
									target="_blank"
									rel="noopener noreferrer"
									referrerPolicy="no-referrer"
								>
									Open in system browser <ArrowUpRight size={15} />
								</a>
								<span className="source-note">
									DIRECT CONNECTION · NO QUERY HISTORY STORED
								</span>
							</div>
						</div>
					</section>
				) : (
					<>
						<div className="deck-heading">
							<div>
								<span className="deck-kicker">
									<span />
									{SEARCH_API_BASE ? "PRIVATE WEB SEARCH" : "LOCAL COLLECTION"}
								</span>
								<h1>
									{submittedQuery || (
										<>
											The web,
											<br />
											<em>in relation.</em>
										</>
									)}
								</h1>
							</div>
							<div className="deck-stats">
								<span>
									{String(records.length).padStart(2, "0")}{" "}
									<small>RESULTS</small>
								</span>
								<span>
									{livePayload ? "LIVE" : "LOCAL"} <small>FIELD</small>
								</span>
							</div>
						</div>
						<search aria-label="Search the web">
							<form className="deck-search" onSubmit={submitSearch}>
								<Search size={17} aria-hidden="true" />
								<label className="visually-hidden" htmlFor="main-search">
									Search the web
								</label>
								<input
									id="main-search"
									ref={searchRef}
									type="search"
									value={query}
									onChange={(event) => setQuery(event.target.value)}
									placeholder={
										SEARCH_API_BASE
											? "Search the web"
											: "Search this collection"
									}
									autoComplete="off"
									list="local-suggestions"
								/>
								<datalist id="local-suggestions">
									{suggestions.map((suggestion) => (
										<option key={suggestion} value={suggestion} />
									))}
								</datalist>
								{query && (
									<button
										type="button"
										className="search-clear"
										onClick={() => {
											setQuery("");
											setSubmittedQuery("");
										}}
										aria-label="Clear search"
									>
										<X size={15} />
									</button>
								)}
								<button className="search-go" type="submit" aria-label="Search">
									<ArrowRight size={17} />
								</button>
							</form>
						</search>
						<div className="field-toolbar">
							<span>
								{pending
									? "CONTACTING SEARCH GATEWAY"
									: liveFailed
										? "LIVE SEARCH UNAVAILABLE · LOCAL FALLBACK"
										: livePayload
											? `SOURCE · ${livePayload.provider.toUpperCase()}`
											: "DRAG TO ROTATE · SELECT A NODE TO INSPECT"}
							</span>
							<div>
								<label htmlFor="domain-filter">DOMAIN</label>
								<select
									id="domain-filter"
									value={domain}
									onChange={(event) => setDomain(event.target.value)}
								>
									<option value="all">All domains</option>
									{domains.map((value) => (
										<option key={value} value={value}>
											{value}
										</option>
									))}
								</select>
							</div>
						</div>
						<div className="field-zone">
							{pending ? (
								<div className="field-state">
									<span className="pulse-dot" />
									Retrieving live results
								</div>
							) : records.length ? (
								<Suspense
									fallback={
										<div className="field-state">
											<span className="pulse-dot" />
											Preparing relationship field
										</div>
									}
								>
									<ConnectedField
										documents={records}
										selectedId={selected?.id ?? ""}
										onSelect={(document) => {
											setSelectedId(document.id);
											setDetailClosed(false);
										}}
									/>
								</Suspense>
							) : (
								<div className="field-state">
									{index
										? "No matching results in this session."
										: "Loading local index…"}
								</div>
							)}
							{selected && !pending && (
								<aside
									className="float-window"
									aria-label="Selected search result"
								>
									<div className="float-head">
										<span>
											<i /> RESULT WINDOW
										</span>
										<button
											type="button"
											onClick={() => {
												setSelectedId("");
												setDetailClosed(true);
											}}
											aria-label="Close result window"
										>
											<X size={14} />
										</button>
									</div>
									<div className="float-origin">
										{documentDomain(selected)}
										<span>
											{" "}
											/{" "}
											{String(
												records.findIndex((item) => item.id === selected.id) +
													1,
											).padStart(2, "0")}
										</span>
									</div>
									<h2>{selected.title}</h2>
									<p>{selected.description}</p>
									<div className="float-url">{selected.url}</div>
									<div className="float-actions">
										<button
											type="button"
											className="float-primary"
											onClick={() =>
												openPage({ url: selected.url, title: selected.title })
											}
										>
											View page <ArrowUpRight size={14} />
										</button>
										<a
											href={selected.url}
											target="_blank"
											rel="noopener noreferrer"
											referrerPolicy="no-referrer"
											aria-label="Open source in system browser"
											title="Open in system browser"
										>
											<ArrowUpRight size={16} />
										</a>
									</div>
								</aside>
							)}
						</div>
						<nav className="result-ribbon" aria-label="Search result nodes">
							{records.slice(0, 8).map((document, position) => (
								<CompactResult
									key={document.id}
									document={document}
									position={position + 1}
									selected={selected?.id === document.id}
									onClick={() => {
										setSelectedId(document.id);
										setDetailClosed(false);
									}}
								/>
							))}
						</nav>
						<footer className="desk-footer">
							<span>
								<Shield size={12} /> QUERY HISTORY OFF
							</span>
							<span>
								{livePayload
									? "LIVE RESULTS · PROVIDER ORDER"
									: "LOCAL BM25 · BUNDLED INDEX"}
							</span>
							<span>
								{SEARCH_API_BASE
									? "GATEWAY/PROVIDER CAN SEE LIVE QUERIES"
									: "NO REMOTE SEARCH"}
							</span>
						</footer>
						{liveFailed && (
							<div className="gateway-warning" role="status">
								{liveSearch.error}. Showing the bundled collection instead.
							</div>
						)}
					</>
				)}
			</main>
		</div>
	);
}
