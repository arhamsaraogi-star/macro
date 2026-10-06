// macro relay — a tiny Cloudflare Worker that lets the browser app read Yahoo Finance
// and Google News (which don't send CORS headers). Free tier: 100k requests/day.
//
// Deploy: dash.cloudflare.com -> Workers & Pages -> Create -> Worker -> paste this file -> Deploy.
// Then paste the worker URL into the site's Settings (gear icon).

const ALLOWED_HOSTS = new Set([
  "query1.finance.yahoo.com",
  "query2.finance.yahoo.com",
  "news.google.com",
]);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    const target = new URL(request.url).searchParams.get("url");
    let url;
    try { url = new URL(target); } catch { return new Response("missing ?url=", { status: 400, headers: CORS }); }
    if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname)) {
      return new Response("host not allowed", { status: 403, headers: CORS });
    }

    const cache = caches.default;
    const key = new Request(url.toString());
    let res = await cache.match(key);
    if (!res) {
      const upstream = await fetch(url.toString(), {
        headers: { "User-Agent": "Mozilla/5.0 (macro relay)", Accept: "*/*" },
        cf: { cacheTtl: 3600 },
      });
      res = new Response(upstream.body, upstream);
      res.headers.set("Cache-Control", "public, max-age=3600");
      if (upstream.ok) ctx.waitUntil(cache.put(key, res.clone()));
    }
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(CORS)) out.headers.set(k, v);
    return out;
  },
};
