# Privacy

ZeroTracks keeps no search history. The current query and investigation state exist only in page memory; they are not put in the URL, browser local storage, or service-worker cache. **New session** clears the query, filters, selection, and graph. The selected theme is the only persistent ZeroTracks preference.

## Default promise

With no `VITE_SEARCH_API_URL`, searches run against the bundled local index. ZeroTracks sends no query to a search provider or remote gateway. This is the strict privacy mode and is the default for local development and GitHub Pages deployments.

## Live search data flow

When a live gateway is configured and a query is submitted:

1. The browser sends the query in a JSON `POST` body to the gateway over HTTPS with cookies omitted, no referrer, and `cache: no-store`; the query is not part of the ZeroTracks page URL.
2. The gateway operator can see the query and the connecting IP address while handling the request.
3. The gateway forwards the query to DuckDuckGo's public HTML results page. DuckDuckGo receives the query and the gateway's network address, not the user's direct browser connection.
4. The gateway returns titles, snippets, and links. It does not write application query/access logs, and the response is marked `no-store`.

The service worker caches only static application files and the bundled index. It explicitly excludes `/api/` requests. This does not control logging by an externally hosted gateway, reverse proxy, hosting provider, or search provider. Run the gateway yourself if you want to control its deployment and logging; that still does not hide submitted queries from the operator or provider.

Without a configured gateway, all searches use only the bundled local index. That mode does not contact a search provider.

## Limits

ZeroTracks is not Tor Browser, Tails, a VPN, or a hardened browser. The source handoff is not a browser security boundary or network proxy. It does not anonymize the user to the gateway, route traffic through Tor, prevent fingerprinting by other websites, scan downloads, or guarantee protection from malicious results. Opening a source makes a direct connection from the browser and exposes ordinary connection metadata to the destination. Use a separately configured Tor Browser/Tails environment for those protections.

The only persistent preference is the selected color theme in browser local storage. The service worker uses the Cache API for same-origin application files and the bundled index. Clearing this site's data in browser settings removes both.