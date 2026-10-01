const CACHE_NAME = "zerotracks-shell-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const scope = self.registration.scope;
      const manifestUrl = new URL(".vite/manifest.json", scope);
      const manifestResponse = await fetch(manifestUrl);
      if (!manifestResponse.ok) {
        throw new Error("Unable to read the static asset manifest.");
      }
      const manifest = await manifestResponse.json();
      const assets = Object.values(manifest).flatMap((entry) => [
        entry.file,
        ...(entry.css ?? []),
        ...(entry.assets ?? []),
      ]);
      const urls = new Set([
        new URL("./", scope).href,
        new URL("data/search-index.json", scope).href,
        new URL("manifest.webmanifest", scope).href,
        new URL("icon.svg", scope).href,
        manifestUrl.href,
        ...assets.map((asset) => new URL(asset, scope).href),
      ]);
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll([...urls]);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const requestUrl = new URL(request.url);
  if (
    request.method !== "GET" ||
    requestUrl.origin !== self.location.origin ||
    requestUrl.pathname.split("/").includes("api")
  ) {
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (response.ok) await cache.put(request, response.clone());
        return response;
      } catch {
        if (request.mode === "navigate") {
          return (
            (await cache.match(new URL("./", self.registration.scope))) ??
            Response.error()
          );
        }
        return Response.error();
      }
    })(),
  );
});