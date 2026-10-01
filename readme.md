# ZeroTracks

ZeroTracks is an open-source web metasearch frontend with a user-operated search gateway. The gateway forwards submitted queries to DuckDuckGo's public HTML results page and returns structured links/snippets. Results appear as selectable nodes in a connected relationship field with visible strings and a floating detail window. The selected source opens through an explicit source handoff to the system browser. The browser also keeps a small bundled index for offline and gateway-unavailable searches.

ZeroTracks does not use SearXNG code, AI models, API keys, accounts, cookies, or a hosted ZeroTracks search provider. This is a small metasearch prototype, not a Google-scale crawler or independent web index. Provider HTML can change or be rate-limited.

**Privacy pledge:** ZeroTracks does not send or store search data by default. Local mode is the default in development and on GitHub Pages. Live web search is opt-in and requires setting `VITE_SEARCH_API_URL`; when enabled, the configured gateway and upstream provider receive the submitted query.

## Run locally

```sh
git clone <repository>
cd zerotracks
npm install
npm run dev
```

`npm run dev` starts the Vite frontend and the Node search service. The frontend stays local-only unless `VITE_SEARCH_API_URL` is explicitly set. Node.js 20.19+ or 22.12+ is required; the Pages workflow uses Node.js 24.

To run only the search service, use `npm run search`. It listens on `127.0.0.1:8788` by default and writes no query/access logs. Configure `SEARCH_HOST=0.0.0.0` only when exposing it on your own server, and set an exact `ALLOWED_ORIGINS` list.

## Commands

```sh
npm run build
npm run build:live-preview
npm run preview
npm run test
npm run lint
```

`npm run build` generates the local inverted index and creates a static, local-index-only app in `dist/`. `npm run build:live-preview` explicitly opts into the same-origin live gateway for local preview; `npm run preview` serves that configured build. Do not publish a live-preview build to a static host unless its `/api` path is actually routed to your search service.

## Architecture

```text
Browser UI
  -> user's HTTPS search gateway
  -> DuckDuckGo HTML results
  -> validated structured hits
  -> result inspection and relationship graph

Bundled local documents -> generated inverted index -> offline/fallback results
```

The gateway fetches provider HTML server-side, extracts titles, snippets, and HTTP(S) destinations, removes provider redirect/tracking URLs, and returns an uncached JSON response. The frontend sends queries in POST bodies and never calls DuckDuckGo directly. Live results are adapted to the same document inspector and deterministic graph as local records. See [docs/architecture.md](docs/architecture.md).

The bundled demo dataset contains 12 public-resource references. Its browser ranking is deterministic BM25-style retrieval with phrase matching, bounded typo correction, filters, and pagination. Live result order comes from the upstream provider. Live web coverage therefore depends on DuckDuckGo and is not an independently crawled index.

The source handoff is not a full browser engine. Source navigation uses the normal direct connection and is not anonymized by ZeroTracks.

## Privacy model

In default local mode, queries stay in the browser and no website receives them. The browser does not store query history or put queries in the URL. The gateway process does not write query/access logs, API responses are `no-store`, and the service worker never caches `/api` responses. Live mode is an explicit exception: the gateway operator can see queries and the connecting IP address, and DuckDuckGo receives the query and gateway address. See [docs/privacy.md](docs/privacy.md).

**New session** clears the current query, filters, selected record, and investigation state. The selected color theme is the only ZeroTracks preference stored in browser local storage.

ZeroTracks is not Tor Browser or Tails. It does not hide the user's address from the gateway, route requests through Tor, isolate the operating system, or guarantee malware protection. Opening a result uses the user's regular browser connection.

## GitHub Pages

The frontend is static and deploys through [.github/workflows/deploy.yml](.github/workflows/deploy.yml). A live search backend cannot run on GitHub Pages; host the Node service separately over HTTPS. Set the repository Actions variable `ZEROTRACKS_SEARCH_API_URL` to the public service URL ending in `/api`, and add the Pages origin to the service's `ALLOWED_ORIGINS`. If the variable is unset, Pages uses the bundled local index only.

In repository settings, select **Pages → Build and deployment → GitHub Actions**. The project-site base path is configured automatically. No provider API key is required.

## No AI

ZeroTracks does not use AI model APIs or local language models. Local ranking and graph relationships are deterministic algorithms.

## License

AGPL-3.0-or-later. See [LICENSE](LICENSE).