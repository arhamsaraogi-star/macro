// Runs the site's own engine against live data (through the relay in site/config.js and
// GDELT) for moves whose real trigger is well documented, and prints what the app would show.
import { readFileSync } from "node:fs";

globalThis.window = globalThis;
globalThis.location ??= { hostname: process.env.LOCAL ? "localhost" : "cli", origin: "", search: "" };
eval(readFileSync(new URL("../site/config.js", import.meta.url), "utf8"));
if (process.env.LOCAL) globalThis.MACRO_CONFIG.local = true;
// Browsers have DOMParser (used to read Google News RSS); Node needs a stand-in.
try { globalThis.DOMParser ??= (await import("linkedom")).DOMParser; } catch { /* optional */ }
if (process.env.RELAY) globalThis.MACRO_CONFIG.relay = process.env.RELAY;
if (process.env.NEWS_RELAY) globalThis.MACRO_CONFIG.news = process.env.NEWS_RELAY;
const engine = await import("../site/js/engine.js");

const CASES = [
  { symbol: "ITC.NS", name: "ITC Limited", date: "2017-07-18", truth: "GST compensation cess hike on cigarettes (regulatory)" },
  { symbol: "INFY.NS", name: "Infosys Limited", date: "2017-08-18", truth: "CEO Vishal Sikka resigns (management)" },
  { symbol: "YESBANK.NS", name: "Yes Bank Limited", date: "2018-09-21", truth: "RBI curtails CEO Rana Kapoor's term (regulatory/management)" },
  { symbol: "ADANIENT.NS", name: "Adani Enterprises Limited", date: "2023-01-27", truth: "Hindenburg short-seller report (governance)" },
  { symbol: "HDFCBANK.NS", name: "HDFC Bank Limited", date: "2024-01-17", truth: "Q3 FY24 results: margin / deposit disappointment (results)" },
  { symbol: "PAYTM.NS", name: "One 97 Communications Limited", date: "2024-02-01", truth: "RBI restrictions on Paytm Payments Bank (regulatory)" },
  { symbol: "ONGC.NS", name: "Oil and Natural Gas Corporation Limited", date: "2020-03-09", truth: "Crude oil collapse (Saudi–Russia price war) + COVID market crash" },
  { symbol: "BAJFINANCE.NS", name: "Bajaj Finance Limited", date: "2020-03-23", truth: "COVID market crash (market-wide)" },
  { symbol: "TDPOWERSYS.NS", name: "TD Power Systems Limited", date: "2026-09-15", truth: "AI slowdown announcement (theme) — per user" },
];

const pct = (x) => (x == null ? "—" : `${x > 0 ? "+" : ""}${(x * 100).toFixed(1)}%`);
const z = (x) => (x == null ? "" : ` (${Math.abs(x).toFixed(1)}σ)`);

const only = process.env.CASES ? process.env.CASES.split(",") : null;
for (const c of CASES.filter((x) => !only || only.includes(x.symbol))) {
  console.log(`\n================ ${c.symbol} ${c.date} — truth: ${c.truth}`);
  try {
    const data = await engine.analyze({
      symbol: c.symbol, hint: { symbol: c.symbol, name: c.name, source: "list" }, mode: "percent",
      thresholds: { daily: 2, weekly: 0, monthly: 0 }, years: "max", sigmaYears: 1,
    });
    console.log(`industry: ${data.industry.name} | sector: ${data.sectorIndex?.name ?? "none"} ${data.sectorIndex?.peers ? `(${data.sectorIndex.peers.join(",")})` : ""}`);
    console.log(`factors: ${data.factorsTracked.map((f) => `${f.name}${f.available ? "" : "(n/a)"}`).join(", ")}`);
    const ev = data.events.find((e) => e.end === c.date) || data.events.find((e) => Math.abs(Date.parse(e.end) - Date.parse(c.date)) <= 3 * 864e5);
    if (!ev) { console.log("NO EVENT >=2% within 3 days of that date"); continue; }
    console.log(`move ${ev.end}: ${pct(ev.change)}${z(ev.zScore)} | driver=${ev.driver}${ev.alsoMoved.length ? " +" + ev.alsoMoved.join("&") : ""} | market ${pct(ev.benchmarkChange)}${z(ev.benchmarkZ)} | sector ${pct(ev.sectorChange)}${z(ev.sectorZ)}`);
    console.log(`episodes: ${ev.episodes.map((x) => x.name).join("; ") || "—"}`);
    console.log(`factors: ${ev.factors.map((f) => `${f.name} ${pct(f.change)}${z(f.z)} β=${f.beta ?? "?"} share=${f.share == null ? "?" : Math.round(f.share * 100) + "%"}${f.explains ? " [EXPLAINS]" : ""}`).join(" | ")}`);
    const t0 = Date.now();
    const n = await engine.news({ symbol: data.symbol, name: data.info.name, start: ev.start, end: ev.end, sector: data.info.sector, industry: data.info.industry, extra: engine.contextQueries(ev, data) });
    console.log(`news in ${((Date.now() - t0) / 1000).toFixed(1)}s, errors: ${n.errors.join(" / ") || "none"}`);
    console.log(`filings: ${n.items.filter((it) => it.scope === "filing").length}, headlines via ${n.via}`);
    for (const it of n.items.slice(0, 10)) console.log(`  [${it.scope}/${it.via}] ${it.date} ${it.primary} {${(it.buckets || []).join(",")}} ${it.tone > 0 ? "▲" : it.tone < 0 ? "▼" : "·"} ${it.title}`);
    const t = engine.triggerText(ev, n, data);
    console.log(`>>> APP SAYS: ${t?.text ?? "—"}   (likelyTrigger=${n.likelyTrigger})`);
  } catch (e) {
    console.log("ERROR", e.message);
  }
}
