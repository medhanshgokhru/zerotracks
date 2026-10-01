# Architecture

ZeroTracks has a static frontend, a separate stateless Node search gateway, and a bundled local index. The gateway is optional for GitHub Pages; without it, the app searches only its local dataset.

```text
Browser
        -> HTTPS /api/search?q=...
        -> ZeroTracks Node gateway
        -> DuckDuckGo HTML search page
        -> URL validation and HTML extraction
        -> live results / inspector / relationship graph

data/documents.json
        -> scripts/build-index.ts
        -> public/data/search-index.json
        -> local BM25 fallback and offline search
```

## Search gateway

`server/index.mjs` accepts bounded `POST /api/search` JSON requests, checks the configured CORS allowlist, disables HTTP caching, and returns JSON. Queries travel in the request body rather than the application URL. The service does not write query or access logs. `server/duckduckgo.mjs` fetches DuckDuckGo's public HTML results page and parses result markup with Cheerio. It unwraps provider redirects, permits only HTTP(S) URLs, drops tracking parameters, and deduplicates destinations. Requests have a timeout and provider failures return a generic 502 response.

This adapter depends on a third-party HTML interface, not a documented search API. It can be blocked or changed by the provider. It is neither a crawler nor an independent web-scale index. Additional providers require their own adapter, terms review, and privacy disclosure.

## Browser search

In development, Vite proxies `/api` to `127.0.0.1:8788`. A production Pages build can receive `VITE_SEARCH_API_URL` pointing at the user's HTTPS gateway. Search requests use `cache: no-store`, omit credentials, and suppress the referrer. The service worker caches only the static shell/index and excludes API paths. Queries remain in page memory and are not serialized into the URL or local storage.

When live search is unavailable, the UI falls back to the prebuilt 12-document local index. Local retrieval uses normalized token postings, BM25-style weighting, phrase matching, bounded Levenshtein expansion, filters, sorting, and pagination. Live provider hits share the same document inspector and deterministic relationship graph; their initial ranking is the provider's order. Search records become selectable nodes in a flat connected-string field; shared domains, indexed entities, and matching terms form visible relationship curves. A floating result window hands the selected URL to the system browser without attempting unreliable cross-origin iframe embedding.

## Privacy boundaries

The gateway necessarily receives the user's query and source IP. The upstream provider receives the query and the gateway's IP. ZeroTracks does not write application query logs, but reverse proxies, hosting infrastructure, and the provider have separate policies and may retain network metadata. This design is not anonymous and does not provide Tor routing or browser/operating-system protections.

## Deployment

GitHub Pages hosts only the static `dist/` frontend. Host the Node gateway separately over HTTPS and configure `ZEROTRACKS_SEARCH_API_URL` as a repository Actions variable. Configure the gateway's `ALLOWED_ORIGINS` with the exact Pages origin. A Pages deployment with no gateway variable remains a local-index app.

```text
data/documents.json
        |
        v
scripts/build-index.ts  ->  public/data/search-index.json
                                  |
                                  v
Browser UI -> query parser -> inverted index -> BM25 ranking -> results
                                  |
                                  v
                      relationship graph and inspector
```

## Index generation

The build utility normalizes structured document records, removes duplicate canonical URLs, tokenizes searchable fields, and emits term postings, document frequencies, and document-length statistics. The browser loads the prebuilt JSON; it does not rebuild the index. The bundled demo has 12 source records and is intentionally small. For a larger corpus, move retrieval into a Web Worker and split the index into fetchable static shards.

## Query and ranking

Text normalization folds accents and case, and tokenization removes a small English stop-word list. Quoted phrases, `site:domain`, `url:fragment`, and `-excluded-term` are parsed locally. Results use deterministic BM25-style term scoring with title and description boosts, exact phrase boosts, and bounded Levenshtein expansion for missing terms. Domain, collection, URL, sort, and page constraints are applied locally.

## Investigation

Relationships are derived from matching domains, explicit indexed entities, and shared normalized terms. The graph starts from one selected document and produces a stable one-hop neighborhood. Its layout is deterministic; pan and zoom are presentation state only.

## Static deployment

Vite writes only static assets to `dist/`. The GitHub Actions workflow sets a repository-aware base path, tests and lints the code, builds the site, and deploys the artifact with GitHub Pages. A same-origin service worker precaches the built manifest assets and search index for later offline visits.