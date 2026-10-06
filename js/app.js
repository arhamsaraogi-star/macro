/* macro — move forensics frontend (vanilla JS + lightweight-charts), runs fully in the browser */
import * as engine from "./engine.js";

{
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  const state = {
    selected: null,
    mode: "percent",
    thresholds: { percent: [5, 5, 5], sigma: [2, 2, 2] },
    data: null,
    frame: "daily",
    chartFrame: "daily",
    dir: "all",
    sort: "date",
    page: 0,
    bandK: 2,
    news: new Map(),
    charts: {},
  };
  const PAGE = 25;

  /* ---------- formatting ---------- */
  const pct = (x, d = 2) => (x == null ? "—" : `${x > 0 ? "+" : ""}${(x * 100).toFixed(d)}%`);
  const cls = (x) => (x == null ? "" : x > 0 ? "pos" : x < 0 ? "neg" : "");
  const num = (x, d = 2) => (x == null ? "—" : Number(x).toFixed(d));
  const times = (x) => (x == null ? "—" : `${Number(x).toFixed(2)}×`);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtDate = (d) => new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  const compact = (x) => (x == null ? "—" : Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(x));
  const exChip = (ex, board) => {
    if (board === "SME") return `<span class="chip sme">${ex} SME</span>`;
    if (ex === "NSE") return `<span class="chip nse">NSE</span>`;
    if (ex === "BSE") return `<span class="chip bse">BSE</span>`;
    return ex ? `<span class="chip">${esc(ex)}</span>` : "";
  };
  const label = (k) => state.data?.categoryLabels?.[k] || k;

  const relayHelp = (msg) => /relay/.test(msg) ? `${esc(msg)}<br><br>Free public relays are rate-limited and sometimes down. <a href="#" class="open-settings">Set up your own free relay</a> (2 minutes) for reliable data.` : esc(msg);

  /* ---------- search ---------- */
  const q = $("#q"), dd = $("#dropdown"), goBtn = $("#goBtn");
  let searchTimer, opts = [], active = -1;

  function renderDropdown(items, loading) {
    opts = items;
    active = items.length ? 0 : -1;
    if (loading) { dd.innerHTML = `<div class="opt-empty"><span class="spinner"></span>Searching NSE / BSE…</div>`; dd.hidden = false; return; }
    if (!items.length) { dd.innerHTML = `<div class="opt-empty">No listings found. Try the NSE symbol (e.g. TATAMOTORS) or 6-digit BSE code.</div>`; dd.hidden = false; return; }
    dd.innerHTML = items.map((r, i) => `
      <div class="opt ${i === active ? "active" : ""}" data-i="${i}">
        <div class="nm"><b>${esc(r.name)}</b><span>${esc([r.sector, r.industry].filter(Boolean).join(" · ") || (r.source === "direct" ? "Use ticker as typed" : ""))}</span></div>
        <span class="sym">${esc(r.symbol)}</span>${exChip(r.exchange, r.board)}
      </div>`).join("");
    dd.hidden = false;
  }

  q.addEventListener("input", () => {
    clearTimeout(searchTimer);
    const v = q.value.trim();
    goBtn.disabled = !v;
    if (v.length < 2) { dd.hidden = true; return; }
    searchTimer = setTimeout(async () => {
      renderDropdown([], true);
      try {
        const results = await engine.search(v);
        if (q.value.trim() === v) renderDropdown(results);
      } catch (e) {
        if (q.value.trim() === v) dd.innerHTML = `<div class="opt-empty">${relayHelp(e.message)}</div>`;
      }
    }, 240);
  });
  q.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!opts.length) return;
      e.preventDefault();
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + opts.length) % opts.length;
      $$(".opt", dd).forEach((el, i) => el.classList.toggle("active", i === active));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (!dd.hidden && opts[active]) choose(opts[active], true);
      else if (q.value.trim()) { choose({ symbol: q.value.trim().toUpperCase(), name: q.value.trim().toUpperCase(), exchange: "", board: "" }, true); }
    } else if (e.key === "Escape") dd.hidden = true;
  });
  dd.addEventListener("mousedown", (e) => {
    const el = e.target.closest(".opt");
    if (el) { e.preventDefault(); choose(opts[+el.dataset.i], true); }
  });
  q.addEventListener("blur", () => setTimeout(() => (dd.hidden = true), 120));
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement !== q && !/INPUT|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); q.focus(); }
    if (e.key === "Escape") closeDrawer();
  });

  function choose(r, run) {
    state.selected = r;
    q.value = r.name && r.source !== "direct" ? r.name : r.symbol;
    dd.hidden = true;
    goBtn.disabled = false;
    $("#selected").innerHTML = `Selected <span class="chip">${esc(r.symbol)}</span> ${exChip(r.exchange, r.board)} ${r.source === "search" ? esc(r.name) : ""}`;
    if (run) analyze();
  }

  /* ---------- controls ---------- */
  const thInputs = [$("#thDaily"), $("#thWeekly"), $("#thMonthly")];
  $("#modeSeg").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    state.thresholds[state.mode] = thInputs.map((i) => +i.value);
    state.mode = b.dataset.mode;
    $$("#modeSeg button").forEach((x) => x.classList.toggle("on", x === b));
    thInputs.forEach((i, n) => { i.value = state.thresholds[state.mode][n]; i.step = state.mode === "sigma" ? "0.25" : "0.5"; });
    $$(".ctl .unit").forEach((u) => (u.textContent = state.mode === "sigma" ? "±σ" : "±%"));
    $(".sigma-only").hidden = state.mode !== "sigma";
  });
  goBtn.addEventListener("click", () => {
    if (!state.selected && q.value.trim()) state.selected = { symbol: q.value.trim().toUpperCase(), name: q.value.trim() };
    analyze();
  });

  function segBind(id, key, after) {
    $(id).addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      $$(`${id} button`).forEach((x) => x.classList.toggle("on", x === b));
      state[key] = Object.values(b.dataset)[0];
      after();
    });
  }
  segBind("#frameSeg", "frame", () => { state.page = 0; renderTable(); renderYears(); });
  segBind("#dirSeg", "dir", () => { state.page = 0; renderTable(); });
  segBind("#chartFrameSeg", "chartFrame", () => renderMarkers());
  segBind("#bandSeg", "bandK", () => renderSigmaChart());
  $("#sortSel").addEventListener("change", (e) => { state.sort = e.target.value; state.page = 0; renderTable(); });

  /* ---------- analyse ---------- */
  function status(msg, err) {
    const el = $("#status");
    el.hidden = !msg;
    el.className = "status" + (err ? " err" : "");
    el.innerHTML = msg || "";
  }

  async function analyze() {
    const sel = state.selected;
    if (!sel) return;
    const [d, w, m] = thInputs.map((i) => i.value || 0);
    goBtn.disabled = true; goBtn.classList.add("loading");
    status(`<span class="spinner"></span>Pulling price history for <b>${esc(sel.symbol)}</b> and scanning for moves…`);
    try {
      const data = await engine.analyze({
        symbol: sel.symbol, hint: sel, mode: state.mode,
        thresholds: { daily: +d, weekly: +w, monthly: +m },
        years: $("#years").value, sigmaYears: +$("#sigmaYears").value,
      });
      state.data = data;
      state.news = new Map();
      state.page = 0;
      history.replaceState(null, "", `${location.search}#${encodeURIComponent(data.symbol)}`);
      status("");
      render();
    } catch (e) {
      status(relayHelp(e.message), true);
    } finally {
      goBtn.disabled = false; goBtn.classList.remove("loading");
    }
  }

  function render() {
    const d = state.data;
    $("#results").hidden = false;
    $("#demoBadge").hidden = !d.demo;
    renderCompany(); renderTiles(); renderPriceChart(); renderSigmaChart(); renderYears(); renderTable();
    $("#dna").innerHTML = `<p class="muted">Scans headlines around the largest ${state.frame} moves and classifies them (orders, monthly sales, results, USFDA, block deals…) so you can see what typically triggers this stock.</p>`;
    setTimeout(() => $("#results").scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  function renderCompany() {
    const d = state.data, info = d.info || {}, last = d.series[d.series.length - 1], prev = d.series[d.series.length - 2];
    const chg = prev ? last.c / prev.c - 1 : null;
    $("#coName").textContent = info.name || d.symbol;
    $("#coMeta").innerHTML = `
      <span class="chip">${esc(d.symbol)}</span>${exChip(d.exchange, d.board)}
      ${info.sector ? `<span>${esc(info.sector)}${info.industry ? " · " + esc(info.industry) : ""}</span>` : ""}
      <span class="muted">· data since ${fmtDate(d.firstDate)} (${d.listedYears}y) · vs ${esc(d.benchmark.name)}</span>`;
    $("#playbook").innerHTML = `Typical triggers for this sector: ` + d.playbook.map((p) => `<span class="chip cat">${esc(p.label)}</span>`).join("");
    const cs = d.currentSigma;
    $("#coRight").innerHTML = `
      <div class="px">₹${num(last.c)}</div>
      <div class="${cls(chg)}" style="font-family:var(--mono)">${pct(chg)} <span class="muted">${fmtDate(last.t)}</span></div>
      <div class="sig">${d.params.sigmaYears}y σ · day ${pct(cs.daily, 2).replace("+", "")} · wk ${pct(cs.weekly, 1).replace("+", "")} · mo ${pct(cs.monthly, 1).replace("+", "")}</div>`;
  }

  function renderTiles() {
    const s = state.data.summary, p = state.data.params, unit = p.mode === "sigma" ? "σ" : "%";
    const th = p.thresholds;
    const tile = (k, v, dsc) => `<div class="glass tile"><div class="k">${k}</div><div class="v">${v}</div><div class="d">${dsc}</div></div>`;
    const frameTile = (f, name) => {
      const x = s[f] || {};
      return tile(`${name} moves ≥ <span class="nc">±${th[f]}${unit}</span>`, x.count ?? 0,
        x.count ? `<span class="pos">▲ ${x.up}</span> · <span class="neg">▼ ${x.down}</span> · max ${pct(x.biggestUp, 1)} / ${pct(x.biggestDown, 1)}` : "none in range");
    };
    const x = s.daily?.count ? s.daily : s.weekly?.count ? s.weekly : s.monthly || {};
    const share = (v) => (v == null ? "—" : `${Math.round(v * 100)}%`);
    $("#tiles").innerHTML =
      frameTile("daily", "Daily") + frameTile("weekly", "Weekly") + frameTile("monthly", "Monthly") +
      tile("Volume build-up before", share(x.volumeBuildupShare), `of moves had pre-week volume ≥1.5× normal`) +
      tile("Stock-specific", share(x.stockSpecificShare), `moves not explained by ${esc(state.data.benchmark.name)}`) +
      tile("Follow-through", share(x.followThroughShare), `kept going the next 5 sessions`);
  }

  /* ---------- charts ---------- */
  const chartOpts = (el) => ({
    width: el.clientWidth, height: el.clientHeight,
    layout: { background: { type: "solid", color: "transparent" }, textColor: "rgba(232,236,255,0.6)", fontFamily: "Inter" },
    grid: { vertLines: { color: "rgba(255,255,255,0.04)" }, horzLines: { color: "rgba(255,255,255,0.05)" } },
    rightPriceScale: { borderColor: "rgba(255,255,255,0.1)" },
    timeScale: { borderColor: "rgba(255,255,255,0.1)", minBarSpacing: 0.01 },
    crosshair: { mode: 0, vertLine: { color: "rgba(255,255,255,.3)", labelBackgroundColor: "#2a2f5a" }, horzLine: { color: "rgba(255,255,255,.3)", labelBackgroundColor: "#2a2f5a" } },
  });

  function makeChart(key, el) {
    const old = state.charts[key];
    if (old) { old.ro?.disconnect(); old.chart.remove(); delete state.charts[key]; }
    if (!window.LightweightCharts) { el.innerHTML = `<p class="muted" style="padding:20px">Chart library failed to load.</p>`; return null; }
    const chart = LightweightCharts.createChart(el, chartOpts(el));
    const ro = new ResizeObserver(() => chart.applyOptions({ width: el.clientWidth, height: el.clientHeight }));
    ro.observe(el);
    state.charts[key] = { chart, ro };
    return chart;
  }

  function renderPriceChart() {
    const el = $("#priceChart"), d = state.data;
    const chart = makeChart("price", el); if (!chart) return;
    const area = chart.addAreaSeries({
      lineColor: "#9fb0ff", topColor: "rgba(139,155,255,0.38)", bottomColor: "rgba(139,155,255,0.0)", lineWidth: 2,
      priceFormat: { type: "price", precision: 2, minMove: 0.01 },
    });
    area.setData(d.series.map((p) => ({ time: p.t, value: p.c })));
    const vol = chart.addHistogramSeries({ priceFormat: { type: "volume" }, priceScaleId: "vol" });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    vol.setData(d.series.map((p, i) => ({
      time: p.t, value: p.v || 0,
      color: i && p.c < d.series[i - 1].c ? "rgba(255,107,139,0.35)" : "rgba(62,230,168,0.35)",
    })));
    chart.timeScale().fitContent();
    state.charts.price.area = area;
    renderMarkers();
  }

  function renderMarkers() {
    const c = state.charts.price; if (!c) return;
    const evs = state.data.events.filter((e) => e.frame === state.chartFrame);
    c.area.setMarkers(evs.map((e) => ({
      time: e.end, position: e.direction === "up" ? "belowBar" : "aboveBar",
      color: e.direction === "up" ? "#3ee6a8" : "#ff6b8b",
      shape: e.direction === "up" ? "arrowUp" : "arrowDown",
      text: evs.length < 80 ? pct(e.change, 0) : "",
    })));
  }

  function renderSigmaChart() {
    const el = $("#sigmaChart"), d = state.data, k = +state.bandK;
    const chart = makeChart("sigma", el); if (!chart) return;
    const hist = chart.addHistogramSeries({ priceFormat: { type: "custom", formatter: (v) => v.toFixed(2) + "%" } });
    let breaches = 0, valid = 0;
    hist.setData(d.returns.filter((r) => r.r != null).map((r) => {
      const out = r.s != null && Math.abs(r.r) >= k * r.s;
      if (r.s != null) { valid++; if (out) breaches++; }
      return { time: r.t, value: r.r * 100, color: out ? (r.r > 0 ? "#3ee6a8" : "#ff6b8b") : "rgba(255,255,255,0.18)" };
    }));
    const band = (sign) => {
      const s = chart.addLineSeries({ color: "rgba(255,197,107,0.75)", lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      s.setData(d.returns.filter((r) => r.s != null).map((r) => ({ time: r.t, value: sign * k * r.s * 100 })));
    };
    band(1); band(-1);
    chart.timeScale().fitContent();
    $("#sigmaLegend").innerHTML = `Dashed: ±${k}σ of trailing ${d.params.sigmaYears}y daily returns · ${breaches} breaches out of ${valid} sessions (${valid ? ((breaches / valid) * 100).toFixed(1) : 0}%; a normal distribution would give ${({ 1: "31.7", 2: "4.6", 3: "0.3" })[k]}%)`;
  }

  function renderYears() {
    const s = state.data.summary[state.frame] || {}, ys = s.byYear || [];
    $("#yearFrameLabel").textContent = state.frame;
    if (!ys.length) { $("#yearBars").innerHTML = `<p class="muted">No ${state.frame} events.</p>`; return; }
    const max = Math.max(...ys.map((y) => y.up + y.down));
    $("#yearBars").innerHTML = ys.map((y) => `
      <div class="yb" title="${y.year}: ▲${y.up} ▼${y.down}">
        <div class="u" style="height:${(y.up / max) * 82}%"></div>
        <div class="dn" style="height:${(y.down / max) * 82}%"></div>
        <small>${y.year}</small>
      </div>`).join("");
  }

  /* ---------- table ---------- */
  const FLAG_TXT = {
    volume_buildup: ["vol build-up", "hot"], pre_drift_same: ["pre-drift", "hot"], pre_drift_opposite: ["pre-reversal", ""],
    event_volume_spike: ["vol spike", ""], stock_specific: ["stock-specific", "spec"], market_driven: ["market-driven", ""],
    follow_through: ["follow-through", ""], reversal: ["reversed", ""],
  };

  function filtered() {
    let evs = state.data.events.filter((e) => e.frame === state.frame && (state.dir === "all" || e.direction === state.dir));
    const by = {
      date: (a, b) => b.end.localeCompare(a.end),
      mag: (a, b) => Math.abs(b.change) - Math.abs(a.change),
      z: (a, b) => Math.abs(b.zScore ?? 0) - Math.abs(a.zScore ?? 0),
      prevol: (a, b) => (b.pre.volumeRatio ?? 0) - (a.pre.volumeRatio ?? 0),
    }[state.sort];
    return evs.sort(by);
  }

  function renderTable() {
    const evs = filtered(), pages = Math.ceil(evs.length / PAGE);
    state.page = Math.min(state.page, Math.max(pages - 1, 0));
    $("#evCount").textContent = `· ${evs.length} ${state.frame}`;
    const rows = evs.slice(state.page * PAGE, (state.page + 1) * PAGE);
    $("#evTable tbody").innerHTML = rows.length ? rows.map((e) => {
      const n = state.news.get(e.id);
      const dateTxt = e.frame === "daily" ? fmtDate(e.end) : `${fmtDate(e.start)} → ${fmtDate(e.end)}`;
      return `<tr data-id="${e.id}">
        <td>${dateTxt}</td>
        <td class="${cls(e.change)}"><b>${pct(e.change)}</b></td>
        <td>${e.zScore == null ? "—" : num(Math.abs(e.zScore), 1) + "σ"}</td>
        <td class="${cls(e.benchmarkChange)}">${pct(e.benchmarkChange, 1)}</td>
        <td class="${cls(e.pre.change)}">${pct(e.pre.change, 1)}</td>
        <td>${times(e.pre.volumeRatio)}</td>
        <td>${times(e.eventVolumeRatio)}</td>
        <td class="${cls(e.postChange)}">${pct(e.postChange, 1)}</td>
        <td><div class="flags">${e.flags.filter((f) => FLAG_TXT[f] && !["follow_through", "reversal", "market_driven"].includes(f)).map((f) => `<span class="flag ${FLAG_TXT[f][1]}">${FLAG_TXT[f][0]}</span>`).join("")}</div></td>
        <td class="trig">${n ? (n.likelyTrigger ? esc(label(n.likelyTrigger)) : "unclear") : `<span class="muted">open ›</span>`}</td>
      </tr>`;
    }).join("") : `<tr><td colspan="10" class="muted" style="text-align:center;font-family:Inter">No events at this threshold — try lowering it.</td></tr>`;
    $("#pager").innerHTML = pages > 1 ? Array.from({ length: pages }, (_, i) =>
      (i < 2 || i > pages - 3 || Math.abs(i - state.page) < 2) ? `<button data-p="${i}" class="${i === state.page ? "on" : ""}">${i + 1}</button>` :
        (Math.abs(i - state.page) === 2 ? `<span class="muted">…</span>` : "")).join("") : "";
  }
  $("#pager").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { state.page = +b.dataset.p; renderTable(); } });
  $("#evTable tbody").addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-id]"); if (!tr) return;
    const ev = state.data.events.find((x) => x.id === tr.dataset.id);
    if (ev) openEvent(ev);
  });

  $("#csvBtn").addEventListener("click", () => {
    const evs = filtered();
    const head = ["frame", "start", "end", "direction", "change_pct", "z_score", "index_change_pct", "pre_week_change_pct", "pre_week_volume_x", "move_volume_x", "next5d_pct", "flags", "likely_trigger"];
    const p = (x) => (x == null ? "" : (x * 100).toFixed(2));
    const lines = evs.map((e) => [e.frame, e.start, e.end, e.direction, p(e.change), e.zScore ?? "", p(e.benchmarkChange), p(e.pre.change),
      e.pre.volumeRatio ?? "", e.eventVolumeRatio ?? "", p(e.postChange), e.flags.join("|"), state.news.get(e.id)?.likelyTrigger ?? ""].join(","));
    const blob = new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `${state.data.symbol}-${state.frame}-moves.csv` });
    a.click(); URL.revokeObjectURL(a.href);
  });

  /* ---------- news ---------- */
  async function loadNews(ev) {
    if (state.news.has(ev.id)) return state.news.get(ev.id);
    const info = state.data.info || {};
    const n = await engine.news({
      symbol: state.data.symbol, name: info.name || state.data.symbol, start: ev.start, end: ev.end,
      sector: info.sector || "", industry: info.industry || "",
    });
    state.news.set(ev.id, n);
    return n;
  }

  /* ---------- drawer ---------- */
  const drawer = $("#drawer"), scrim = $("#scrim");
  function closeDrawer() { drawer.classList.remove("open"); scrim.hidden = true; drawer.setAttribute("aria-hidden", "true"); }
  $("#drawerClose").addEventListener("click", closeDrawer);
  scrim.addEventListener("click", closeDrawer);

  function signalsFor(e) {
    const out = [], bn = state.data.benchmark.name;
    if (e.pre.volumeRatio != null) {
      out.push(e.flags.includes("volume_buildup")
        ? `<b>Volume build-up:</b> the 5 sessions before averaged ${times(e.pre.volumeRatio)} normal volume — positioning ahead of the move.`
        : `Pre-week volume was ${times(e.pre.volumeRatio)} normal — no unusual accumulation beforehand.`);
    }
    if (e.flags.includes("pre_drift_same")) out.push(`<b>Pre-drift:</b> price already moved ${pct(e.pre.change, 1)} the week before, in the same direction (anticipation / leak).`);
    if (e.flags.includes("pre_drift_opposite")) out.push(`<b>Reversal setup:</b> price moved ${pct(e.pre.change, 1)} the week before — opposite to the big move.`);
    if (e.eventVolumeRatio != null) out.push(`Volume during the move was ${times(e.eventVolumeRatio)} the 50-day norm${e.eventVolumeRatio >= 2 ? " — strong conviction" : ""}.`);
    if (e.benchmarkChange != null) out.push(e.flags.includes("market_driven")
      ? `<b>Market-driven:</b> ${esc(bn)} moved ${pct(e.benchmarkChange, 1)} over the same period.`
      : `<b>Stock-specific:</b> ${esc(bn)} moved only ${pct(e.benchmarkChange, 1)}; relative move ${pct(e.relativeChange, 1)}.`);
    if (e.postChange != null) out.push(`Next 5 sessions: ${pct(e.postChange, 1)} (${e.flags.includes("follow_through") ? "follow-through" : "partial reversal"}).`);
    return out;
  }

  function miniChart(e) {
    const s = state.data.series, i0 = s.findIndex((p) => p.t === e.start), i1 = s.findIndex((p) => p.t === e.end);
    let pts, evFrom;
    if (i0 >= 5 && i1 >= 0) { const a = i0 - 5, b = Math.min(i1, i0 + 40); pts = s.slice(a, b + 1); evFrom = i0 - a; }
    else { pts = e.pre.series.map((p) => ({ t: p.d, c: p.c, v: p.v })); evFrom = pts.length; }
    if (pts.length < 2) return "";
    const W = 500, H = 150, pad = 8, vH = 42;
    const cs = pts.map((p) => p.c), mn = Math.min(...cs), mx = Math.max(...cs), vMax = Math.max(...pts.map((p) => p.v || 0), e.baselineVolume || 0) || 1;
    const x = (i) => pad + (i / (pts.length - 1)) * (W - pad * 2);
    const y = (c) => pad + (1 - (c - mn) / (mx - mn || 1)) * (H - vH - pad * 2);
    const bw = Math.max(2, (W - pad * 2) / pts.length - 3);
    const bars = pts.map((p, i) => `<rect x="${x(i) - bw / 2}" y="${H - ((p.v || 0) / vMax) * vH}" width="${bw}" height="${((p.v || 0) / vMax) * vH}" rx="2" fill="${i >= evFrom ? (e.direction === "up" ? "#3ee6a8" : "#ff6b8b") : "rgba(159,176,255,.55)"}" opacity="${i >= evFrom ? .85 : .6}"/>`).join("");
    const base = e.baselineVolume ? `<line x1="${pad}" x2="${W - pad}" y1="${H - (e.baselineVolume / vMax) * vH}" y2="${H - (e.baselineVolume / vMax) * vH}" stroke="rgba(255,197,107,.8)" stroke-dasharray="4 4"/>` : "";
    const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.c).toFixed(1)}`).join(" ");
    const shade = evFrom < pts.length ? `<rect x="${x(evFrom) - bw}" y="0" width="${W - x(evFrom) + bw - pad / 2}" height="${H}" fill="${e.direction === "up" ? "rgba(62,230,168,.08)" : "rgba(255,107,139,.08)"}"/>` : "";
    return `<svg class="mini" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${shade}${bars}${base}<path d="${line}" fill="none" stroke="#e6eaff" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>
      <div class="legend muted" style="font-size:11.5px">${fmtDate(pts[0].t)} → ${fmtDate(pts[pts.length - 1].t)} · shaded = the move · dashed = 50-day avg volume</div>`;
  }

  function newsHtml(n) {
    if (!n.items.length) return `<p class="muted">No headlines found for ${fmtDate(n.window.from)} – ${fmtDate(n.window.to)}${n.errors?.length ? " (news source unreachable)" : ""}. Older periods and SME stocks have thinner coverage.</p>`;
    const counts = Object.entries(n.categoryCounts).sort((a, b) => b[1] - a[1]);
    return `<div class="row" style="margin-bottom:10px">${counts.map(([k, c]) => `<span class="chip cat">${esc(label(k))} · ${c}</span>`).join("")}</div>` +
      n.items.map((it) => `<a class="news-item" href="${esc(it.url)}" target="_blank" rel="noopener">
        <div class="t">${esc(it.title)}</div>
        <div class="m">${it.date ? fmtDate(it.date) : ""} ${it.source ? "· " + esc(it.source) : ""} ${it.categories.filter((c) => c !== "other").map((c) => `<span class="chip cat">${esc(label(c))}</span>`).join("")}</div>
      </a>`).join("");
  }

  async function openEvent(e) {
    const dateTxt = e.frame === "daily" ? fmtDate(e.end) : `${fmtDate(e.start)} → ${fmtDate(e.end)}`;
    $("#drawerBody").innerHTML = `
      <div class="dw-title">${e.frame} move · ${dateTxt}</div>
      <div class="dw-move ${cls(e.change)}">${pct(e.change)}</div>
      <div class="dw-sub">₹${num(e.prevClose)} → ₹${num(e.close)} ${e.zScore != null ? `· <b>${num(Math.abs(e.zScore), 1)}σ</b> vs trailing ${state.data.params.sigmaYears}y` : ""}</div>
      <div class="kv">
        <div><small>Pre-week</small><b class="${cls(e.pre.change)}">${pct(e.pre.change, 1)}</b></div>
        <div><small>Pre-vol ×</small><b>${times(e.pre.volumeRatio)}</b></div>
        <div><small>Move vol ×</small><b>${times(e.eventVolumeRatio)}</b></div>
        <div><small>${esc(state.data.benchmark.name)}</small><b class="${cls(e.benchmarkChange)}">${pct(e.benchmarkChange, 1)}</b></div>
        <div><small>Relative</small><b class="${cls(e.relativeChange)}">${pct(e.relativeChange, 1)}</b></div>
        <div><small>Next 5d</small><b class="${cls(e.postChange)}">${pct(e.postChange, 1)}</b></div>
      </div>
      <div class="section-t">The week before → the move <button class="btn ghost" id="zoomBtn" style="padding:5px 10px;font-size:12px">Show on chart</button></div>
      ${miniChart(e)}
      <div class="section-t">What the tape says</div>
      <div class="signals">${signalsFor(e).map((s) => `<div class="signal">${s}</div>`).join("")}</div>
      <div class="section-t">News around the move <span class="muted" id="likely"></span></div>
      <div id="newsBox"><p class="muted"><span class="spinner"></span>Searching headlines…</p></div>`;
    drawer.classList.add("open"); scrim.hidden = false; drawer.setAttribute("aria-hidden", "false");
    drawer.scrollTop = 0;
    $("#zoomBtn").onclick = () => {
      closeDrawer();
      const c = state.charts.price?.chart; if (!c) return;
      const t = new Date(e.end), from = new Date(t - 120 * 864e5), to = new Date(+t + 60 * 864e5);
      c.timeScale().setVisibleRange({ from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) });
      $("#priceChart").scrollIntoView({ behavior: "smooth", block: "center" });
    };
    try {
      const n = await loadNews(e);
      if (!drawer.classList.contains("open")) return;
      $("#newsBox").innerHTML = newsHtml(n);
      $("#likely").innerHTML = n.likelyTrigger ? `likely: <b style="color:var(--ink)">${esc(label(n.likelyTrigger))}</b>` : "";
      renderTable();
    } catch (err) {
      $("#newsBox").innerHTML = `<p class="muted">Couldn't load news: ${relayHelp(err.message)}</p>`;
    }
  }

  /* ---------- trigger DNA ---------- */
  $("#dnaBtn").addEventListener("click", async () => {
    const d = state.data; if (!d) return;
    const n = +$("#dnaCount").value;
    const evs = d.events.filter((e) => e.frame === state.frame).sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, n);
    if (!evs.length) { $("#dna").innerHTML = `<p class="muted">No ${state.frame} events to scan.</p>`; return; }
    const btn = $("#dnaBtn"); btn.disabled = true;
    let done = 0;
    $("#dna").innerHTML = `<div class="muted">Scanning news for the ${evs.length} largest ${state.frame} moves…</div><div class="progress"><div style="width:0%"></div></div>`;
    const queue = [...evs];
    const worker = async () => {
      while (queue.length) {
        const e = queue.shift();
        try { await loadNews(e); } catch { /* skip */ }
        done++;
        const bar = $("#dna .progress div"); if (bar) bar.style.width = `${(done / evs.length) * 100}%`;
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    btn.disabled = false;
    renderDNA(evs);
    renderTable();
  });

  function renderDNA(evs) {
    const agg = { up: {}, down: {} }, tot = { up: 0, down: 0 };
    for (const e of evs) {
      const n = state.news.get(e.id); if (!n) continue;
      const k = n.likelyTrigger || "other";
      agg[e.direction][k] = (agg[e.direction][k] || 0) + 1; tot[e.direction]++;
    }
    const block = (dir) => {
      const rows = Object.entries(agg[dir]).sort((a, b) => b[1] - a[1]);
      if (!rows.length) return `<p class="muted">No ${dir} moves in this set.</p>`;
      const max = rows[0][1];
      return rows.map(([k, c]) => `<div class="bar-row"><span>${esc(label(k))}</span><div class="track"><div class="fill ${dir}" style="width:${(c / max) * 100}%"></div></div><b>${c}</b></div>`).join("");
    };
    const top = (dir) => Object.entries(agg[dir]).filter(([k]) => k !== "other").sort((a, b) => b[1] - a[1])[0];
    const tu = top("up"), td = top("down"), name = esc(state.data.info?.name || state.data.symbol);
    const vb = evs.filter((e) => e.flags.includes("volume_buildup")).length;
    let insight = `Across the ${evs.length} biggest ${state.frame} moves in ${name}: `;
    insight += tu ? `rallies most often lined up with <b>${esc(label(tu[0]))}</b> (${Math.round((tu[1] / tot.up) * 100)}% of up-moves)` : "up-moves had no clear news pattern";
    insight += td ? `, sell-offs with <b>${esc(label(td[0]))}</b> (${Math.round((td[1] / tot.down) * 100)}% of down-moves)` : "";
    insight += `. ${vb} of ${evs.length} (${Math.round((vb / evs.length) * 100)}%) showed a volume build-up in the week before.`;
    $("#dna").innerHTML = `<div class="dna-grid">
        <div><h3><span class="pos">▲</span> Up-moves (${tot.up})</h3>${block("up")}</div>
        <div><h3><span class="neg">▼</span> Down-moves (${tot.down})</h3>${block("down")}</div>
      </div><div class="insight">${insight}</div>`;
  }

  /* ---------- settings (own relay) ---------- */
  const dlg = $("#settings");
  function openSettings(e) {
    e?.preventDefault();
    $("#proxyUrl").value = engine.getCustomProxy();
    $("#proxyMsg").textContent = "";
    dlg.showModal();
  }
  $("#settingsBtn").addEventListener("click", openSettings);
  document.addEventListener("click", (e) => { if (e.target.closest(".open-settings")) openSettings(e); });
  $("#proxySave").addEventListener("click", (e) => {
    e.preventDefault();
    const v = $("#proxyUrl").value.trim();
    if (v && !/^https:\/\/.+/.test(v)) { $("#proxyMsg").textContent = "Relay URL must start with https://"; return; }
    engine.setCustomProxy(v);
    dlg.close();
    status(v ? "Using your relay. Search again to load data." : "Using the public relays.");
  });
  $("#proxyCancel").addEventListener("click", (e) => { e.preventDefault(); dlg.close(); });

  /* ---------- boot ---------- */
  $("#demoBadge").hidden = !engine.isDemo;
  const fromHash = decodeURIComponent(location.hash.slice(1));
  if (fromHash) choose({ symbol: fromHash.toUpperCase(), name: fromHash.toUpperCase(), exchange: "", board: "", source: "direct" }, true);
}
