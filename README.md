# ZeroTracks

ZeroTracks is a live web source-network search engine: search the web through a gateway, inspect overlapping language and domains, and jump to the strongest related live sources. Results appear as selectable nodes with a floating source inspector, API-free extractive at-a-glance synthesis, and ranked related-evidence list.

When the optional Node gateway is unavailable, GitHub Pages uses Wikipedia's public CORS-enabled search API as a live provider fallback. This is clearly labeled and is not a bundled/local fallback.

ZeroTracks does not use AI models, API keys, accounts, cookies, or a hosted ZeroTracks search provider. This is a small metasearch prototype, not a Google-scale crawler or independent web index. Provider HTML can change or be rate-limited.

**Privacy pledge:** Searches are sent to the configured live gateway and upstream provider. ZeroTracks does not send searches directly from the browser to DuckDuckGo or maintain a local search index.

## Run locally

```sh
git clone <repository>
cd zerotracks
npm install
npm run dev
```

`npm run dev` starts the Vite frontend and the Node search service. The frontend uses `/api` in development and requires the Node service to remain available. Node.js 20.19+ or 22.12+ is required; the Pages workflow uses Node.js 24.

To run only the search service, use `npm run search`. It listens on `127.0.0.1:8788` by default and writes no query/access logs. Configure `SEARCH_HOST=0.0.0.0` only when exposing it on your own server, and set an exact `ALLOWED_ORIGINS` list.

## Commands

```sh
npm run build
npm run build:live-preview
npm run preview
npm run test
npm run lint
```

`npm run build` creates a live-search app in `dist/`. `npm run build:live-preview` builds for the same-origin live gateway used by local preview; `npm run preview` serves that configured build. A deployed static build must have `VITE_SEARCH_API_URL` or `/api` routed to a live gateway.

## Architecture

```text
Browser UI
  -> user's HTTPS search gateway
  -> DuckDuckGo HTML results
  -> validated structured hits
  -> result inspection and relationship graph

User query -> live gateway -> provider results -> relationship field
```

The gateway fetches provider HTML server-side, extracts titles, snippets, and HTTP(S) destinations, removes provider redirect/tracking URLs, and returns an uncached JSON response. The frontend sends queries in POST bodies and never calls DuckDuckGo directly. Live results are adapted to the same document inspector and deterministic graph as local records. See [docs/architecture.md](docs/architecture.md).

Live result order comes from the upstream provider. Live web coverage therefore depends on DuckDuckGo and is not an independently crawled index.

The source handoff is not a full browser engine. Source navigation uses the normal direct connection and is not anonymized by ZeroTracks.

## Privacy model

The browser does not store query history or put queries in the URL. The gateway process does not write query/access logs, API responses are `no-store`, and the service worker never caches `/api` responses. The gateway operator can see queries and the connecting IP address, and DuckDuckGo receives the query and gateway address. See [docs/privacy.md](docs/privacy.md).

**New session** clears the current query, filters, selected record, and investigation state. The selected color theme is the only ZeroTracks preference stored in browser local storage.

ZeroTracks is not Tor Browser or Tails. It does not hide the user's address from the gateway, route requests through Tor, isolate the operating system, or guarantee malware protection. Opening a result uses the user's regular browser connection.

## GitHub Pages

The frontend is static and deploys through [.github/workflows/deploy.yml](.github/workflows/deploy.yml). A live search backend cannot run on GitHub Pages; host the Node service separately over HTTPS. Set the repository Actions variable `ZEROTRACKS_SEARCH_API_URL` to the public service URL ending in `/api`, and add the Pages origin to the service's `ALLOWED_ORIGINS`. Without a configured live gateway, searches cannot be completed.

In repository settings, select **Pages → Build and deployment → GitHub Actions**. The project-site base path is configured automatically. No provider API key is required.

## No AI

ZeroTracks does not use AI model APIs or local language models. Local ranking and graph relationships are deterministic algorithms.

## License

AGPL-3.0-or-later. See [LICENSE](LICENSE).