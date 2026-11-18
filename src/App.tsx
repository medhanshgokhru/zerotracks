import {
	ArrowLeft,
	ArrowRight,
	ArrowUpRight,
	Moon,
	Plus,
	Search,
	Shield,
	Sun,
	X,
} from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { documentDomain } from "./search/index";
import {
	buildAiSummary,
	buildExtractiveSummary,
	paginateWebSearch,
	rankLiveResults,
	rankRelatedDocuments,
	searchWikipedia,
} from "./search/live";
import { cleanDisplayText } from "./search/tokenizer";
import type {
	DocumentRecord,
	LocalOverview,
	WebSearchPayload,
} from "./search/types";
import { isValidExternalUrl } from "./search/url";

const SEARCH_API_BASE =
	import.meta.env.VITE_SEARCH_API_URL?.trim().replace(/\/+$/, "") || "/api";
const ConnectedField = lazy(() => import("./components/ConnectedField"));

type LiveSearchState = {
	query: string;
	status: "idle" | "loading" | "ready" | "error";
	payload?: WebSearchPayload;
	error?: string;
};

type OverviewState = {
	status: "idle" | "loading" | "ready" | "unavailable";
	payload?: LocalOverview;
	error?: string;
};

type BrowserEntry = {
	url: string;
	title: string;
};

type Theme = "dark" | "light";

function getStoredTheme(): Theme {
	try {
		return localStorage.getItem("zerotracks-theme") === "light"
			? "light"
			: "dark";
	} catch {
		return "dark";
	}
}

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
	const [query, setQuery] = useState("");
	const [submittedQuery, setSubmittedQuery] = useState("");
	const [liveSearch, setLiveSearch] = useState<LiveSearchState>({
		query: "",
		status: "idle",
	});
	const [overview, setOverview] = useState<OverviewState>({ status: "idle" });
	const [selectedId, setSelectedId] = useState("");
	const [detailClosed, setDetailClosed] = useState(false);
	const [domain, setDomain] = useState("all");
	const [browserEntry, setBrowserEntry] = useState<BrowserEntry | null>(null);
	const [browserHistory, setBrowserHistory] = useState<BrowserEntry[]>([]);
	const [browserIndex, setBrowserIndex] = useState(-1);
	const [theme, setTheme] = useState<Theme>(getStoredTheme);
	const searchRef = useRef<HTMLInputElement>(null);
	const addressRef = useRef<HTMLInputElement>(null);
	const overviewWorkerRef = useRef<Worker | null>(null);
	const overviewRequestRef = useRef(0);

	useEffect(() => {
		document.documentElement.dataset.theme = theme;
		try {
			localStorage.setItem("zerotracks-theme", theme);
		} catch {
			// Preferences are optional when storage is unavailable.
		}
	}, [theme]);

	useEffect(() => {
		if (import.meta.env.PROD && "serviceWorker" in navigator) {
			void navigator.serviceWorker
				.register(`${import.meta.env.BASE_URL}service-worker.js`)
				.catch(() => undefined);
		}
	}, []);

	useEffect(() => {
		const worker = new Worker(
			new URL("./search/local-overview.worker.ts", import.meta.url),
			{ type: "module" },
		);
		overviewWorkerRef.current = worker;
		worker.onmessage = (
			event: MessageEvent<
				| { type: "ready"; overview: LocalOverview; requestId: number }
				| { type: "error"; message: string; requestId?: number }
			>,
		) => {
			if (
				event.data.type === "error" &&
				event.data.requestId !== overviewRequestRef.current
			)
				return;
			if (event.data.type === "ready")
				setOverview({ status: "ready", payload: event.data.overview });
			else {
				console.warn("Local overview model unavailable:", event.data.message);
				setOverview({ status: "unavailable", error: event.data.message });
			}
		};
		worker.onerror = (event) => {
			console.warn("Local overview worker failed:", event.message);
			setOverview({ status: "unavailable", error: event.message });
		};
		worker.postMessage({ type: "warmup" });
		return () => {
			worker.terminate();
			overviewWorkerRef.current = null;
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
			.catch(() => {
				if (!controller.signal.aborted) {
					void searchWikipedia(submittedQuery, {
						signal: controller.signal,
					})
						.then((payload) =>
							setLiveSearch({
								query: submittedQuery,
								status: "ready",
								payload,
							}),
						)
						.catch((fallbackError: unknown) => {
							if (!controller.signal.aborted) {
								setLiveSearch({
									query: submittedQuery,
									status: "error",
									error:
										fallbackError instanceof Error
											? fallbackError.message
											: "Live search is unavailable.",
								});
							}
						});
				}
			});
		return () => controller.abort();
	}, [submittedQuery]);

	const livePayload =
		liveSearch.query === submittedQuery && liveSearch.status === "ready"
			? liveSearch.payload
			: undefined;
	useEffect(() => {
		if (!livePayload || !submittedQuery) {
			setOverview({ status: "idle" });
			return;
		}
		setOverview({ status: "loading" });
		const requestId = overviewRequestRef.current + 1;
		overviewRequestRef.current = requestId;
		const timeout = window.setTimeout(() => {
			if (overviewRequestRef.current === requestId)
				setOverview({ status: "unavailable" });
		}, 180_000);
		overviewWorkerRef.current?.postMessage({
			type: "summarize",
			requestId,
			query: submittedQuery,
			results: livePayload.results,
		});
		return () => {
			window.clearTimeout(timeout);
		};
	}, [livePayload, submittedQuery]);
	const liveResults = useMemo(
		() =>
			livePayload
				? paginateWebSearch(rankLiveResults(livePayload, 20), {
						domain,
						pageSize: 20,
					})
				: null,
		[livePayload, domain],
	);
	const pending = Boolean(
		SEARCH_API_BASE &&
			submittedQuery &&
			(liveSearch.query !== submittedQuery || liveSearch.status === "loading"),
	);
	const liveFailed = Boolean(
		submittedQuery &&
			liveSearch.query === submittedQuery &&
			liveSearch.status === "error",
	);
	const result = liveResults;
	const records = result?.results.map((item) => item.document) ?? [];
	const selected =
		records.find((item) => item.id === selectedId) ??
		(!detailClosed ? records[0] : undefined);
	const relatedSources = useMemo(() => {
		return selected ? rankRelatedDocuments(selected, records, 3) : [];
	}, [records, selected]);
	const atAGlance = useMemo(
		() => buildExtractiveSummary(records, submittedQuery, 3),
		[records, submittedQuery],
	);
	const aiSummary = useMemo(
		() => buildAiSummary(records, submittedQuery, 3),
		[records, submittedQuery],
	);
	const overviewSources = useMemo(() => {
		const sourceIds = new Set(overview.payload?.sourceIds ?? []);
		return (
			livePayload?.results.flatMap((hit, index) => {
				if (!sourceIds.has(hit.id)) return [];
				const document = records[index];
				return document ? [document] : [];
			}) ?? []
		);
	}, [livePayload, overview.payload?.sourceIds, records]);
	const domains = useMemo(
		() => [...new Set(records.map(documentDomain))].sort(),
		[records],
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
				<div className="desk-actions">
					<button className="desk-action" type="button" onClick={newSession}>
						<Plus size={14} aria-hidden="true" />
						<span>NEW SESSION</span>
					</button>
					<button
						className="desk-action icon-only"
						type="button"
						onClick={() =>
							setTheme((current) => (current === "dark" ? "light" : "dark"))
						}
						aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
						title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
					>
						{theme === "dark" ? (
							<Sun size={15} aria-hidden="true" />
						) : (
							<Moon size={15} aria-hidden="true" />
						)}
					</button>
					<span className="shortcut-hint">
						<kbd>⌘ K</kbd> FOCUS
					</span>
				</div>
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
								<span className="source-handoff-kicker">
									EXTERNAL SOURCE WARNING
								</span>
								<h2>{browserEntry.title}</h2>
								<p>
									Opening this source leaves ZeroTracks and connects directly
									from your browser. ZeroTracks masks your IP from the search
									provider, but this external source may see your network
									address and browser details. It does not scan downloads or
									guarantee malware protection.
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
									SEARCH VIA GATEWAY · SOURCE OPENS DIRECTLY · NO MALWARE
									SCANNING
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
									LIVE WEB SEARCH
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
								{!submittedQuery && (
									<p className="deck-usp">
										Search live. Find related sources. Trace overlapping
										coverage.
									</p>
								)}
							</div>
							<div className="deck-stats">
								<span className="related-list-main">
									{String(result?.total ?? records.length).padStart(2, "0")}{" "}
									<small>RESULTS</small>
								</span>
								<span>
									LIVE <small>FIELD</small>
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
									placeholder="Search the web"
									autoComplete="off"
								/>
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
						<div className="field-toolbar" aria-live="polite">
							<span>
								{pending
									? "CONTACTING SEARCH GATEWAY"
									: liveFailed
										? "LIVE SEARCH UNAVAILABLE"
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
						{(overview.payload ||
							aiSummary ||
							overview.status === "loading") && (
							<section className="ai-summary" aria-label="AI summary">
								<div className="ai-summary-head">
									<span className="ai-summary-mark">✦</span>
									<div>
										<span className="related-label">
											AI OVERVIEW ·{" "}
											{overview.payload?.model
												? `LOCAL MODEL · ${overview.payload.model}`
												: overview.status === "loading"
													? "LOCAL SYNTHESIS"
													: "LOCAL EVIDENCE"}
										</span>
										<p>{overview.payload?.overview ?? aiSummary?.intro}</p>
									</div>
								</div>
								{overviewSources.length > 0 && (
									<div className="ai-summary-sources">
										<span className="related-label">SELECTED EVIDENCE</span>
										<div>
											{overviewSources.map((document) => (
												<button
													type="button"
													key={document.id}
													onClick={() => {
														setSelectedId(document.id);
														setDetailClosed(false);
													}}
												>
													{cleanDisplayText(document.title)}
												</button>
											))}
										</div>
									</div>
								)}
							</section>
						)}
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
									{liveFailed
										? "Live search unavailable. Try again."
										: submittedQuery
											? "No live results found."
											: "Search the live web."}
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
									<h2>{cleanDisplayText(selected.title)}</h2>
									<p>{cleanDisplayText(selected.description)}</p>
									{atAGlance.length > 0 && (
										<div className="at-a-glance">
											<span className="related-label">AT A GLANCE</span>
											<ul>
												{atAGlance.map((sentence) => (
													<li key={sentence}>{sentence}</li>
												))}
											</ul>
										</div>
									)}
									<div className="float-url">{selected.url}</div>
									{relatedSources.length > 0 && (
										<div className="related-sources">
											<span className="related-label">RELATED SOURCES</span>
											<div className="related-list">
												{relatedSources.map(({ document, overlap }) => (
													<button
														type="button"
														key={document.id}
														onClick={() => {
															setSelectedId(document.id);
															setDetailClosed(false);
														}}
													>
														<span>
															<strong>
																{cleanDisplayText(document.title)}
															</strong>
															<small>{documentDomain(document)}</small>
														</span>
														<b>{overlap} overlap</b>
													</button>
												))}
											</div>
										</div>
									)}
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
									: "LIVE WEB SEARCH"}
							</span>
							<span>SEARCH VIA GATEWAY · SOURCE OPENS DIRECTLY</span>
						</footer>
					</>
				)}
			</main>
		</div>
	);
}
