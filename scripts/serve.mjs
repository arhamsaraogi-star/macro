// Run macro on your own computer: serves the site and fetches market data / news directly
// (no Cloudflare relay, no Apps Script). Node 18+, no dependencies.
//
//   npm start            → http://localhost:8000
//   PORT=9000 npm start  → another port
//
// The browser can't call Yahoo / Google News / NSE itself (cross-site rules), so this server
// does those requests for it at /relay/?url=…, exactly like relay/worker.js does in the cloud.

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../site/", import.meta.url)));
const PORT = Number(process.env.PORT) || 8000;

// Same allowlist as relay/worker.js: host -> allowed path prefixes.
const ALLOWED = {
  "query1.finance.yahoo.com": ["/"],
  "query2.finance.yahoo.com": ["/"],
  "news.google.com": ["/rss/"],
  "www.nseindia.com": ["/api/historicalOR/", "/api/historical/", "/api/corporate-announcements", "/api/corporate-board-meetings"],
  "api.gdeltproject.org": ["/api/v2/doc/"],
};
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon",
};

function headersFor(url) {
  const h = { "User-Agent": UA, Accept: "*/*", "Accept-Language": "en-US,en;q=0.9" };
  if (url.hostname === "www.nseindia.com") {
    h.Accept = "application/json, text/plain, */*";
    h.Referer = url.pathname.startsWith("/api/corporate")
      ? "https://www.nseindia.com/companies-listing/corporate-filings-announcements"
      : "https://www.nseindia.com/report-detail/eq_security";
  }
  return h;
}

// 1-hour in-memory cache of successful upstream responses.
const cache = new Map();
const CACHE_MS = 60 * 60e3;

async function upstream(url) {
  let res = await fetch(url, { headers: headersFor(url), signal: AbortSignal.timeout(30000) });
  if (res.status === 429 && url.hostname.startsWith("query")) {
    const alt = new URL(url);
    alt.hostname = url.hostname.startsWith("query1") ? "query2.finance.yahoo.com" : "query1.finance.yahoo.com";
    res = await fetch(alt, { headers: headersFor(alt), signal: AbortSignal.timeout(30000) });
  }
  return res;
}

async function relay(req, res, target) {
  if (!target) return send(res, 200, JSON.stringify({ relay: "macro", version: 3, local: true }), ".json");
  let url;
  try { url = new URL(target); } catch { return send(res, 400, "bad ?url="); }
  const prefixes = ALLOWED[url.hostname];
  if (url.protocol !== "https:" || !prefixes || !prefixes.some((p) => url.pathname.startsWith(p))) return send(res, 403, "host not allowed");
  const key = url.toString();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return send(res, 200, hit.body, null, hit.type);
  try {
    const up = await upstream(url);
    const body = Buffer.from(await up.arrayBuffer());
    const type = up.headers.get("content-type") || "application/octet-stream";
    if (up.ok) cache.set(key, { at: Date.now(), body, type });
    send(res, up.status, body, null, type);
  } catch (e) {
    send(res, 502, `upstream error: ${e.message}`);
  }
}

function send(res, status, body, ext, type) {
  res.writeHead(status, { "Content-Type": type || TYPES[ext] || "text/plain; charset=utf-8", "Cache-Control": "no-store" });
  res.end(body);
}

async function staticFile(res, pathname) {
  const rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  let file = join(ROOT, rel);
  if (!file.startsWith(ROOT)) return send(res, 403, "forbidden");
  try {
    if ((await stat(file)).isDirectory()) file = join(file, "index.html");
    send(res, 200, await readFile(file), extname(file));
  } catch {
    send(res, 404, "not found");
  }
}

const server = createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (u.pathname === "/relay" || u.pathname === "/relay/") return relay(req, res, u.searchParams.get("url"));
  return staticFile(res, u.pathname);
});

// Build the NSE/BSE ticker list for instant search on first run (refresh: npm run tickers).
if (!existsSync(join(ROOT, "data", "tickers.json"))) {
  console.log("Building the NSE / BSE ticker list for search (first run only)…");
  spawn(process.execPath, [fileURLToPath(new URL("./build-tickers.mjs", import.meta.url))], { stdio: "inherit" });
}

server.listen(PORT, () => {
  console.log(`\n  macro is running →  http://localhost:${PORT}\n  (Ctrl+C to stop)\n`);
});
