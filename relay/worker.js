// macro relay — a tiny Cloudflare Worker that lets the browser app read Yahoo Finance
// and Google News (which don't allow cross-site browser requests). Free tier: 100k requests/day.
//
// Deploy: dash.cloudflare.com -> Workers & Pages -> Create -> Create Worker -> Deploy ->
// Edit code -> paste this file -> Deploy. Then paste the worker URL into the site.

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

// Yahoo rate-limits requests that don't look like a browser.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

async function upstream(url) {
  let res = await fetch(url, { headers: { "User-Agent": UA, Accept: "*/*", "Accept-Language": "en-US,en;q=0.9" } });
  // query1 and query2 are interchangeable; retry on the other host when rate-limited.
  if (res.status === 429 && url.hostname.startsWith("query")) {
    const alt = new URL(url);
    alt.hostname = url.hostname.startsWith("query1") ? "query2.finance.yahoo.com" : "query1.finance.yahoo.com";
    res = await fetch(alt, { headers: { "User-Agent": UA, Accept: "*/*" } });
  }
  return res;
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    const target = new URL(request.url).searchParams.get("url");
    if (!target) return new Response("macro relay is running. Use ?url=<yahoo or google news url>", { headers: CORS });
    let url;
    try { url = new URL(target); } catch { return new Response("bad ?url=", { status: 400, headers: CORS }); }
    if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname)) {
      return new Response("host not allowed", { status: 403, headers: CORS });
    }

    const cache = caches.default;
    const key = new Request(url.toString());
    let res = await cache.match(key);
    if (!res) {
      const up = await upstream(url);
      res = new Response(up.body, up);
      res.headers.set("Cache-Control", "public, max-age=3600");
      if (up.ok) ctx.waitUntil(cache.put(key, res.clone()));
    }
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(CORS)) out.headers.set(k, v);
    return out;
  },
};
