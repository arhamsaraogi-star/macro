import assert from "node:assert/strict";
import { test } from "node:test";

import { analyzeBars, findEvents, periods, summarize } from "../site/js/analysis.js";
import { directCandidates, exchangeOf, parseChart } from "../site/js/market.js";
import { classify, cleanCompanyName, mentionsCompany, playbook, rankNews } from "../site/js/news.js";

// Deterministic bars: tiny alternating moves, one big jump, optional volume build-up.
function makeBars({ n = 400, jumpAt = 300, jump = 0.08, buildup = true, noise = 0.01 } = {}) {
  const bars = [];
  const d = new Date(Date.UTC(2020, 0, 1));
  let c = 100;
  for (let i = 0; i < n; ) {
    if (d.getUTCDay() % 6) {
      const r = i === jumpAt ? jump : (i % 2 ? noise : -noise) * (1 + (i % 7) / 10);
      if (i) c *= Math.exp(r);
      const v = buildup && i >= jumpAt - 5 && i < jumpAt ? 3000 : 1000;
      bars.push({ t: d.toISOString().slice(0, 10), o: c, h: c * 1.01, l: c * 0.99, c, v });
      i++;
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return bars;
}

test("percent threshold finds the jump and the pre-week volume build-up", () => {
  const bars = makeBars();
  const evs = findEvents(bars, { daily: 5 });
  const e = evs.find((x) => x.end === bars[300].t);
  assert.ok(e);
  assert.equal(e.direction, "up");
  assert.ok(Math.abs(e.change - (Math.exp(0.08) - 1)) < 1e-3);
  assert.equal(e.pre.volumeRatio, 3);
  assert.ok(e.flags.includes("volume_buildup"));
  assert.equal(e.pre.series.length, 5);
});

test("sigma mode uses the trailing standard deviation", () => {
  const bars = makeBars({ jump: 0.04 }); // ~4% on ~1% sigma
  assert.ok(!findEvents(bars, { daily: 5 }).some((e) => e.end === bars[300].t));
  const sig = findEvents(bars, { daily: 3 }, { mode: "sigma" });
  const e = sig.find((x) => x.end === bars[300].t);
  assert.ok(e && e.zScore > 3);
  assert.ok(sig.every((x) => Math.abs(x.zScore) >= 3));
});

test("weekly and monthly periods and summary", () => {
  const bars = makeBars();
  for (const f of ["weekly", "monthly"]) {
    const per = periods(bars, f);
    assert.ok(per.every((p) => p.end >= p.start));
    assert.ok(findEvents(bars, { [f]: 5 }).every((e) => e.frame === f));
  }
  const s = summarize(findEvents(bars, { daily: 5, weekly: 5, monthly: 5 }));
  assert.deepEqual(Object.keys(s), ["daily", "weekly", "monthly"]);
  assert.equal(s.daily.count, 1);
});

test("identical benchmark marks the move market-driven", () => {
  const bars = makeBars();
  const e = findEvents(bars, { daily: 5 }, { context: { market: { name: "M", bars } } }).find((x) => x.end === bars[300].t);
  assert.ok(e.flags.includes("market_driven"));
  assert.equal(e.driver, "market");
});

test("analyzeBars clips the view but keeps the analysis warm", () => {
  const bars = makeBars({ n: 1200, jumpAt: 1100 });
  const out = analyzeBars(bars, { thresholds: { daily: 5 }, years: "1" });
  assert.ok(out.series.length < bars.length && out.series.length > 200);
  assert.equal(out.events.length, 1);
  assert.ok(out.returns.length > 0 && out.currentSigma.daily > 0);
});

test("parseChart adjusts OHLC by adjclose and keys bars by IST date", () => {
  const body = { chart: { result: [{
    meta: { gmtoffset: 19800, longName: "X" },
    timestamp: [1704167100, 1704253500, 1704339900],
    indicators: {
      quote: [{ open: [10, 11, null], high: [10, 11, null], low: [10, 11, null], close: [10, 11, null], volume: [5, 6, null] }],
      adjclose: [{ adjclose: [5, 5.5, null] }],
    },
  }] } };
  const { bars } = parseChart(body);
  assert.equal(bars.length, 2);
  assert.equal(bars[0].t, "2024-01-02");
  assert.equal(bars[0].c, 5);
  assert.equal(bars[1].o, 5.5);
  assert.equal(bars[1].v, 6);
});

test("symbols", () => {
  assert.deepEqual(exchangeOf("ABC-SM.NS"), { exchange: "NSE", board: "SME" });
  assert.equal(exchangeOf("500325.BO").exchange, "BSE");
  assert.deepEqual(directCandidates("500325"), ["500325.BO"]);
  assert.deepEqual(directCandidates("tatamotors").slice(0, 2), ["TATAMOTORS.NS", "TATAMOTORS.BO"]);
  assert.deepEqual(directCandidates("larsen and toubro"), []);
});

test("news classification", () => {
  assert.equal(classify("L&T bags mega order from NHAI")[0], "orders");
  assert.equal(classify("Maruti Suzuki October sales rise 12%")[0], "sales");
  assert.equal(classify("Sun Pharma gets USFDA warning letter")[0], "regulatory");
  assert.equal(classify("Infosys Q2 results: net profit up 5%")[0], "results");
  assert.equal(classify("Board approves 1:1 bonus issue")[0], "corporate_action");
  assert.equal(cleanCompanyName("Larsen & Toubro Limited"), "Larsen & Toubro");
  assert.equal(playbook("Consumer Cyclical", "Auto Manufacturers")[0], "sales");
  const r = rankNews([
    { title: "L&T bags order", date: "2024-01-02" },
    { title: "L&T bags order", date: "2024-01-03" },
    { title: "Something else", date: "2023-12-20" },
  ], { start: "2024-01-02", sector: "Industrials" });
  assert.equal(r.items.length, 2);
  assert.equal(r.likelyTrigger, "orders");
});

import { basket, episodesFor, factorsFor, sectorIndexFor } from "../site/js/context.js";
import { classifyTrigger, playbookFor } from "../site/js/playbooks.js";

test("sector index and factor mapping", () => {
  assert.equal(sectorIndexFor("Consumer Cyclical", "Auto Manufacturers"), null);
  assert.deepEqual(playbookFor("Consumer Cyclical", "Auto Manufacturers").peers.slice(0, 2), ["MARUTI.NS", "M&M.NS"]);
  assert.equal(playbookFor("Financial Services", "Banks - Regional").index.symbol, "^NSEBANK");
  assert.equal(sectorIndexFor("Financial Services", "Banks - Regional").symbol, "^NSEBANK");
  assert.equal(sectorIndexFor("Technology", "Information Technology Services").symbol, "^CNXIT");
  assert.equal(sectorIndexFor("", ""), null);
  const pb = (sector, industry, name = "") => playbookFor(sector, industry, name);
  assert.equal(pb("Industrials", "Engineering & Construction").key, "epc");
  assert.equal(pb("Basic Materials", "Specialty Chemicals", "Asian Paints Limited").key, "paints");
  assert.equal(pb("Industrials", "Airlines").key, "airlines");
  assert.equal(pb("Financial Services", "Banks - Regional").key, "banks");
  assert.equal(pb("", "", "Unknown Co").key, "general");
  const air = factorsFor(pb("Industrials", "Airlines"));
  assert.equal(air.find((f) => f.key === "crude").sens, -1);
  assert.ok(air.some((f) => f.key === "vix"));
  assert.equal(factorsFor(pb("Basic Materials", "Steel")).find((f) => f.key === "steel").sens, 1);
});

test("episodes cover the move and the week before", () => {
  assert.ok(episodesFor("2020-03-23", "2020-03-23").some((e) => /COVID/.test(e.name)));
  assert.ok(episodesFor("2016-11-09", "2016-11-09").some((e) => /Demonetisation/.test(e.name)));
  assert.ok(episodesFor("2021-02-03", "2021-02-03").some((e) => e.name === "Union Budget"));
  assert.equal(episodesFor("2017-03-15", "2017-03-15").length, 0);
});

test("sector-driven and commodity-flagged moves", () => {
  const bars = makeBars();
  const flat = bars.map((b) => ({ ...b, c: 100 + (b.t.charCodeAt(9) % 2) * 0.01 })); // market ~flat
  const sector = bars; // sector index moved exactly like the stock
  // commodity: quiet, then a 10% jump on the event day
  const oil = bars.map((b, i) => ({ t: b.t, c: (i >= 300 ? 110 : 100) * (1 + (i % 2) * 0.002) }));
  const e = findEvents(bars, { daily: 5 }, {
    context: { market: { name: "M", bars: flat }, sector: { name: "S", bars: sector }, factors: [{ key: "brent", name: "Brent", why: "x", kind: "factor", sens: 1, bars: oil }] },
  }).find((x) => x.end === bars[300].t);
  assert.equal(e.driver, "sector");
  assert.ok(e.flags.includes("sector_driven"));
  const f = e.factors.find((x) => x.key === "brent");
  assert.ok(f.notable && f.change > 0.09);
  assert.ok(e.flags.includes("macro_factor"));
  assert.ok(f.explains && e.flags.includes("macro_explains"));
  assert.ok(e.sectorChange > 0.08);
});

import { matchTickers, yahooSymbol } from "../site/js/market.js";

test("local ticker search", () => {
  const rows = [
    { n: "TD Power Systems Limited", s: "TDPOWERSYS", x: "NSE", b: "Main" },
    { n: "TD POWER SYSTEMS LTD.", s: "533553", id: "TDPOWERSYS", x: "BSE", b: "Main" },
    { n: "Tata Power Company Limited", s: "TATAPOWER", x: "NSE", b: "Main" },
    { n: "Krishca Strapping Solutions Limited", s: "KRISHCA", x: "NSE", b: "SME" },
  ].map((r) => ({ ...r, key: `${r.n} ${r.s} ${r.id || ""}`.toLowerCase() }));
  const hits = matchTickers(rows, "td power");
  assert.deepEqual(hits.map((r) => r.s), ["TDPOWERSYS", "533553"]);
  assert.equal(matchTickers(rows, "TATAPOWER")[0].s, "TATAPOWER");
  assert.equal(matchTickers(rows, "533553")[0].x, "BSE");
  assert.equal(yahooSymbol(hits[0]), "TDPOWERSYS.NS");
  assert.equal(yahooSymbol(hits[1]), "533553.BO");
  assert.equal(matchTickers(rows, "krishca")[0].b, "SME");
});

test("headline -> trigger bucket + tone", () => {
  const a = classifyTrigger("RBI cuts repo rate by 50 bps; bank stocks rally");
  assert.ok(a.buckets.includes("rates") && a.tone === 1);
  const b = classifyTrigger("Steel prices slump as Chinese exports surge");
  assert.ok(b.buckets.includes("commodities"));
  const c = classifyTrigger("Sun Pharma gets USFDA warning letter, shares fall");
  assert.ok(c.buckets.includes("regulation") && c.tone === -1);
  assert.ok(classifyTrigger("Bharti Airtel announces tariff hike").buckets.includes("pricing"));
});

test("peer basket index", () => {
  const mk = (rets) => { let c = 100; return rets.map((r, i) => ({ t: `2024-01-${String(i + 1).padStart(2, "0")}`, c: (c *= Math.exp(r)) })); };
  const a = mk(Array(90).fill(0.01).map((x, i) => (i ? x : 0)).slice(0, 28));
  assert.equal(basket([a]), null); // too short
  const days = (n, r) => { let c = 100; const out = []; const d = new Date(Date.UTC(2024, 0, 1)); for (let i = 0; i < n; i++) { out.push({ t: d.toISOString().slice(0, 10), c }); c *= Math.exp(r); d.setUTCDate(d.getUTCDate() + 1); } return out; };
  const b = basket([days(100, 0.02), days(100, 0.0)]);
  assert.ok(b.length >= 90);
  assert.ok(Math.abs(Math.log(b[1].c / b[0].c) - 0.01) < 1e-9); // average of 2% and 0%
});

test("company headline relevance filter", () => {
  assert.ok(mentionsCompany("TD Power Systems bags order from Japan", "TD Power Systems Limited", "TDPOWERSYS"));
  assert.ok(!mentionsCompany("Textiles firm Trident posts lower Q3 profit", "TD Power Systems Limited", "TDPOWERSYS"));
  assert.ok(!mentionsCompany("Jyoti CNC Automation IPO: should you subscribe?", "TD Power Systems Limited", "TDPOWERSYS"));
  assert.ok(mentionsCompany("Larsen & Toubro wins mega order", "Larsen & Toubro Limited", "LT"));
  assert.ok(mentionsCompany("Tata Motors Q2 results: profit up", "Tata Motors Limited", "TATAMOTORS"));
  assert.ok(!mentionsCompany("Tata Steel shares fall", "Tata Motors Limited", "TATAMOTORS"));
  assert.ok(mentionsCompany("HAL shares surge on defence order", "Hindustan Aeronautics Limited", "HAL"));
  assert.ok(mentionsCompany("Krishca Strapping IPO lists at premium", "Krishca Strapping Solutions Limited", "KRISHCA"));
  const r = rankNews([{ title: "Trident Q3 profit falls", date: "2024-01-02" }, { title: "TD Power Systems Q3 profit jumps", date: "2024-01-02" }],
    { start: "2024-01-02", name: "TD Power Systems Limited", ticker: "TDPOWERSYS" });
  assert.equal(r.items.length, 1);
});
