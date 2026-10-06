// Builds site/data/tickers.json from the official NSE (main board + Emerge SME) and BSE
// equity lists, so company search works instantly in the browser with no relay.
// Run in CI (see .github/workflows/pages.yml). Keeps the previous file if a source fails.

import { readFile, writeFile, mkdir } from "node:fs/promises";

const OUT = new URL("../site/data/tickers.json", import.meta.url);
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

async function get(url, headers = {}) {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "*/*", ...headers }, signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

function parseCsv(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells = [];
    let cur = "", q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === "," && !q) { cells.push(cur.trim()); cur = ""; }
      else cur += ch;
    }
    cells.push(cur.trim());
    rows.push(cells);
  }
  const [head, ...body] = rows;
  const keys = head.map((h) => h.toUpperCase().replace(/[^A-Z]+/g, "_").replace(/^_|_$/g, ""));
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? ""])));
}

const tidy = (s) => (s || "").replace(/\s+/g, " ").trim();

async function nse() {
  const out = [];
  const main = parseCsv(await get("https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv"));
  for (const r of main) {
    if (!r.SYMBOL) continue;
    // n = name, s = NSE symbol, x = exchange, b = board, i = ISIN
    out.push({ n: tidy(r.NAME_OF_COMPANY), s: r.SYMBOL, x: "NSE", b: "Main", i: r.ISIN_NUMBER });
  }
  try {
    const sme = parseCsv(await get("https://nsearchives.nseindia.com/emerge/corporates/content/SME_EQUITY_L.csv"));
    for (const r of sme) {
      if (!r.SYMBOL) continue;
      out.push({ n: tidy(r.NAME_OF_COMPANY), s: r.SYMBOL, x: "NSE", b: "SME", i: r.ISIN_NUMBER });
    }
  } catch (e) { console.warn("NSE SME list failed:", e.message); }
  return out;
}

async function bse() {
  const out = [];
  for (const segment of ["Equity", "SME"]) {
    try {
      const url = `https://api.bseindia.com/BseIndiaAPI/api/ListofScripData/w?Group=&Scripcode=&industry=&segment=${segment}&status=Active`;
      const data = JSON.parse(await get(url, { Referer: "https://www.bseindia.com/", Origin: "https://www.bseindia.com" }));
      for (const r of data) {
        if (!r.SCRIP_CD) continue;
        out.push({ n: tidy(r.Issuer_Name || r.Scrip_Name), s: String(r.SCRIP_CD), id: r.scrip_id || "", x: "BSE", b: segment === "SME" ? "SME" : "Main", i: r.ISIN_NUMBER || "", ind: tidy(r.INDUSTRY) });
      }
    } catch (e) { console.warn(`BSE ${segment} list failed:`, e.message); }
  }
  return out;
}

const [n, b] = await Promise.allSettled([nse(), bse()]);
// BSE's SME query can return the main list again: keep one row per exchange + code.
const seen = new Set();
const rows = [...(n.value || []), ...(b.value || [])].filter((r) => {
  const k = `${r.x}:${r.s}`;
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});
if (n.status === "rejected") console.warn("NSE list failed:", n.reason?.message);
console.log(`NSE ${n.value?.length ?? 0}, BSE ${b.value?.length ?? 0} (raw), ${rows.length} unique`);

if (rows.length < 1000) {
  try {
    await readFile(OUT);
    console.warn("Too few rows; keeping the existing tickers.json");
    process.exit(0);
  } catch {
    console.warn("Too few rows and no existing file; writing what we have");
  }
}
await mkdir(new URL("../site/data/", import.meta.url), { recursive: true });
await writeFile(OUT, JSON.stringify({ updated: new Date().toISOString().slice(0, 10), rows }));
console.log(`wrote ${rows.length} tickers`);
