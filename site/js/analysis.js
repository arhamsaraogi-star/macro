// Big-move detection and pre-move (1 week prior) price/volume forensics.
// Pure functions: work in the browser and in Node (tests).

export const FRAMES = ["daily", "weekly", "monthly"];
export const PRE_DAYS = 5; // one trading week before the move
export const POST_DAYS = 5; // follow-through window after the move
export const BASELINE_DAYS = 50; // "normal" volume, measured before the pre-window
export const VOLUME_BUILDUP = 1.5; // pre-window volume / baseline that counts as a build-up
export const PERIODS_PER_YEAR = { daily: 252, weekly: 52, monthly: 12 };
const MIN_SIGMA_OBS = { daily: 60, weekly: 26, monthly: 12 };

const fin = (x) => typeof x === "number" && Number.isFinite(x);
export const round = (x, nd = 4) => (fin(x) ? Math.round(x * 10 ** nd) / 10 ** nd : null);
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

function std(a) {
  if (a.length < 2) return null;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}

// Bucket key for a YYYY-MM-DD date: itself (daily), the Friday ending its week, or YYYY-MM.
function bucket(date, frame) {
  if (frame === "daily") return date;
  if (frame === "monthly") return date.slice(0, 7);
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + ((5 - d.getUTCDay() + 7) % 7));
  return d.toISOString().slice(0, 10);
}

/**
 * One row per period: start/end bar positions, period return, and the trailing standard
 * deviation of that frame's returns over `sigmaYears` (excluding the period itself).
 * @param {{t:string,c:number}[]} bars
 */
export function periods(bars, frame, sigmaYears = 1) {
  const rows = [];
  let cur = null;
  bars.forEach((b, i) => {
    const k = bucket(b.t, frame);
    if (!cur || cur.key !== k) {
      cur = { key: k, start: i, end: i };
      rows.push(cur);
    } else cur.end = i;
  });
  for (let i = 0; i < rows.length; i++) {
    rows[i].ret = i ? bars[rows[i].end].c / bars[rows[i - 1].end].c - 1 : null;
  }
  const window = Math.max(Math.round(PERIODS_PER_YEAR[frame] * sigmaYears), MIN_SIGMA_OBS[frame]);
  for (let i = 1; i < rows.length; i++) {
    const past = [];
    for (let j = Math.max(1, i - window); j < i; j++) past.push(rows[j].ret);
    const s = past.length >= MIN_SIGMA_OBS[frame] ? std(past) : null;
    rows[i].sigma = s;
    rows[i].z = s ? rows[i].ret / s : null;
  }
  return rows.slice(1);
}

// Last close at or before `date` in a sorted bar array.
function asof(bars, date) {
  let lo = 0, hi = bars.length - 1, ans = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].t <= date) { ans = bars[mid].c; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/**
 * Every period whose absolute move crosses the threshold.
 * mode "percent": threshold is a % move (5 -> ±5%).
 * mode "sigma":   threshold is a multiple of the trailing σ of that frame's returns.
 */
export function findEvents(bars, thresholds, { bench = null, mode = "percent", sigmaYears = 1 } = {}) {
  const close = bars.map((b) => b.c);
  const vol = bars.map((b) => b.v || 0);
  const events = [];

  for (const frame of FRAMES) {
    const thr = thresholds[frame];
    if (!(thr > 0)) continue;
    for (const p of periods(bars, frame, sigmaYears)) {
      const hit = mode === "sigma" ? p.z != null && Math.abs(p.z) >= thr : Math.abs(p.ret) >= thr / 100;
      if (!hit) continue;
      const s = p.start, e = p.end;
      const preA = s - PRE_DAYS, preB = s;
      const pre = bars.slice(Math.max(preA, 0), Math.max(preB, 0));
      const baseVol = vol.slice(Math.max(preA - BASELINE_DAYS, 0), Math.max(preA, 0)).filter((v) => v > 0);
      const baseline = baseVol.length >= 10 ? mean(baseVol) : null;

      const preVol = pre.length ? mean(pre.map((b) => b.v || 0)) : null;
      const evVol = mean(vol.slice(s, e + 1));
      const preRet = preA >= 1 ? close[preB - 1] / close[preA - 1] - 1 : null;
      const preMoves = [];
      for (let i = Math.max(preA, 1); i < preB; i++) preMoves.push(Math.abs(close[i] / close[i - 1] - 1));
      const preMaxAbs = preMoves.length ? Math.max(...preMoves) : null;
      const preLow = pre.length ? Math.min(...pre.map((b) => b.l ?? b.c)) : null;
      const preRange = pre.length && preLow > 0 ? Math.max(...pre.map((b) => b.h ?? b.c)) / preLow - 1 : null;
      const postRet = e + 1 < close.length ? close[Math.min(e + POST_DAYS, close.length - 1)] / close[e] - 1 : null;

      let benchRet = null;
      if (bench && bench.length) {
        const p0 = asof(bench, bars[s >= 1 ? s - 1 : s].t), p1 = asof(bench, bars[e].t);
        if (p0 > 0 && p1 != null) benchRet = p1 / p0 - 1;
      }

      const volRatioPre = baseline && preVol != null ? preVol / baseline : null;
      const volRatioEvent = baseline ? evVol / baseline : null;
      const up = p.ret > 0;
      const flags = [];
      if (volRatioPre != null && volRatioPre >= VOLUME_BUILDUP) flags.push("volume_buildup");
      const moveThr = mode === "sigma" ? Math.abs(p.ret) : thr / 100;
      if (preRet != null && Math.abs(preRet) >= Math.max(moveThr / 2, 0.02)) {
        flags.push(preRet > 0 === up ? "pre_drift_same" : "pre_drift_opposite");
      }
      if (volRatioEvent != null && volRatioEvent >= 2) flags.push("event_volume_spike");
      if (benchRet != null) {
        flags.push(Math.abs(benchRet) >= Math.abs(p.ret) * 0.5 && benchRet > 0 === up ? "market_driven" : "stock_specific");
      }
      if (postRet != null) flags.push(postRet > 0 === up ? "follow_through" : "reversal");

      events.push({
        id: `${frame}-${bars[e].t}`,
        frame,
        direction: up ? "up" : "down",
        start: bars[s].t,
        end: bars[e].t,
        change: round(p.ret),
        sigma: round(p.sigma),
        zScore: round(p.z, 2),
        close: round(close[e], 2),
        prevClose: s >= 1 ? round(close[s - 1], 2) : null,
        benchmarkChange: round(benchRet),
        relativeChange: benchRet != null ? round(p.ret - benchRet) : null,
        pre: {
          from: preB > 0 ? bars[Math.max(preA, 0)].t : null,
          to: preB > 0 ? bars[preB - 1].t : null,
          change: round(preRet),
          maxDailyMove: round(preMaxAbs),
          range: round(preRange),
          avgVolume: round(preVol, 0),
          volumeRatio: round(volRatioPre, 2),
          series: pre.map((b) => ({ d: b.t, c: round(b.c, 2), v: round(b.v || 0, 0) })),
        },
        eventVolumeRatio: round(volRatioEvent, 2),
        baselineVolume: round(baseline, 0),
        postChange: round(postRet),
        flags,
      });
    }
  }
  return events.sort((a, b) => a.end.localeCompare(b.end));
}

export function summarize(events) {
  const out = {};
  for (const frame of FRAMES) {
    const evs = events.filter((e) => e.frame === frame);
    if (!evs.length) { out[frame] = { count: 0, byYear: [] }; continue; }
    const up = evs.filter((e) => e.direction === "up");
    const down = evs.filter((e) => e.direction === "down");
    const share = (g, f) => (g.length ? round(g.filter((e) => e.flags.includes(f)).length / g.length, 3) : null);
    const avg = (g, get) => { const v = g.map(get).filter(fin); return v.length ? round(mean(v)) : null; };
    const zs = evs.map((e) => e.zScore).filter(fin).map(Math.abs);
    const years = {};
    for (const e of evs) {
      const y = e.end.slice(0, 4);
      (years[y] ||= { year: y, up: 0, down: 0 })[e.direction]++;
    }
    out[frame] = {
      count: evs.length,
      up: up.length,
      down: down.length,
      biggestUp: up.length ? Math.max(...up.map((e) => e.change)) : null,
      biggestDown: down.length ? Math.min(...down.map((e) => e.change)) : null,
      maxAbsZ: zs.length ? Math.max(...zs) : null,
      volumeBuildupShare: share(evs, "volume_buildup"),
      volumeBuildupShareUp: share(up, "volume_buildup"),
      volumeBuildupShareDown: share(down, "volume_buildup"),
      stockSpecificShare: share(evs, "stock_specific"),
      followThroughShare: share(evs, "follow_through"),
      avgPreChangeUp: avg(up, (e) => e.pre.change),
      avgPreChangeDown: avg(down, (e) => e.pre.change),
      avgPreVolumeRatio: avg(evs, (e) => e.pre.volumeRatio),
      byYear: Object.keys(years).sort().map((k) => years[k]),
    };
  }
  return out;
}

/**
 * Full analysis bundle used by the UI. `years` = "max" or a number of years to show;
 * the analysis always runs on the full history so σ and volume baselines are warm.
 */
export function analyzeBars(bars, { thresholds, bench = null, mode = "percent", years = "20", sigmaYears = 1 }) {
  let events = findEvents(bars, thresholds, { bench, mode, sigmaYears });
  let view = bars;
  if (years !== "max") {
    const last = new Date(bars[bars.length - 1].t + "T00:00:00Z");
    last.setUTCFullYear(last.getUTCFullYear() - Number(years));
    const cutoff = last.toISOString().slice(0, 10);
    view = bars.filter((b) => b.t >= cutoff);
    events = events.filter((e) => e.end >= cutoff);
  }
  const daily = periods(bars, "daily", sigmaYears);
  const firstView = view[0]?.t;
  const returns = daily.filter((p) => bars[p.end].t > firstView).map((p) => ({ t: bars[p.end].t, r: round(p.ret), s: round(p.sigma) }));
  const currentSigma = {};
  for (const frame of FRAMES) {
    const rets = periods(bars, frame, sigmaYears).map((p) => p.ret);
    const last = rets.slice(-PERIODS_PER_YEAR[frame] * Math.max(Math.floor(sigmaYears), 1));
    currentSigma[frame] = last.length > 2 ? round(std(last)) : null;
  }
  return {
    firstDate: bars[0].t,
    lastDate: bars[bars.length - 1].t,
    listedYears: Math.round(((Date.parse(bars[bars.length - 1].t) - Date.parse(bars[0].t)) / (365.25 * 864e5)) * 10) / 10,
    currentSigma,
    series: view.map((b) => ({ t: b.t, o: round(b.o, 2), h: round(b.h, 2), l: round(b.l, 2), c: round(b.c, 2), v: round(b.v || 0, 0) })),
    returns,
    events,
    summary: summarize(events),
  };
}
