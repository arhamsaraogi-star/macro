import assert from "node:assert/strict";
import { test } from "node:test";

import { analyzeBars, findEvents, periods, summarize } from "../site/js/analysis.js";
import { directCandidates, exchangeOf, parseChart } from "../site/js/market.js";
import { classify, cleanCompanyName, playbook, rankNews } from "../site/js/news.js";

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
  const e = findEvents(bars, { daily: 5 }, { bench: bars }).find((x) => x.end === bars[300].t);
  assert.ok(e.flags.includes("market_driven"));
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
