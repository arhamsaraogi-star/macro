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
    if (ex === "BSE" && board === "Main/SME") return `<span class="chip bse">BSE</span>`;
    if (ex === "NSE") return `<span class="chip nse">NSE</span>`;
    if (ex === "BSE") return `<span class="chip bse">BSE</span>`;
    return ex ? `<span class="chip">${esc(ex)}</span>` : "";
  };
  const DRIVER = { market: "Market-wide", sector: "Sector-wide", stock: "Stock-specific" };
  const EXTRA_LABELS = { market_wide: "Market-wide move (index-led)", sector_wide: "Sector-wide move" };
  const label = (k) => EXTRA_LABELS[k] || state.data?.categoryLabels?.[k] || k;
  const driverChip = (d) => `<span class="drv ${d}">${DRIVER[d]}</span>`;
  const notableFactors = (e) => (e.factors || []).filter((f) => f.notable && f.kind === "factor");
  /** Best single-line explanation of a move: driver first, then company news. */
  function triggerOf(e) {
    if (e.driver === "market") return { key: "market_wide", text: e.episodes?.[0]?.name || "Market-wide move" };
    if (e.driver === "sector") {
      const f = notableFactors(e)[0];
      return { key: "sector_wide", text: `${state.data.sectorIndex?.name || "Sector"} move${f ? ` · ${f.name} ${pct(f.change, 0)}` : ""}` };
    }
    const n = state.news.get(e.id);
    if (!n) return null;
    return { key: n.likelyTrigger || "other", text: n.likelyTrigger ? label(n.likelyTrigger) : "unclear" };
  }

  function relayHelp(msg) {
    if (/No data relay/.test(msg)) { showRelaySetup(true); return `Connect a data relay first (one-time, ~2 minutes) — see the steps above.`; }
    if (/updated relay code/.test(msg)) {
      showRelaySetup(true, true);
      return `${esc(msg)} Open the relay code link above, copy it, and in Cloudflare: your worker → Edit code → paste → Deploy. No other change needed.`;
    }
    return /relay/.test(msg) ? `${esc(msg)} <a href="#" class="open-settings">Check relay settings</a>.` : esc(msg);
  }
  function showRelaySetup(scroll, update) {
    const el = $("#relaySetup");
    el.hidden = false;
    el.classList.toggle("update", !!update);
    $("#relaySetup h2").textContent = update ? "One-time update: re-paste the relay code" : "One-time setup: connect a free data relay";
    if (scroll) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }

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
        <div class="nm"><b>${esc(r.name)}</b><span>${esc([r.sector, r.industry].filter(Boolean).join(" · ") || (r.source === "direct" ? "Use ticker as typed" : r.isin || ""))}</span></div>
        <span class="sym">${esc(r.code || r.symbol)}</span>${exChip(r.exchange, r.board)}
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
    $("#selected").innerHTML = `Selected <span class="chip">${esc(r.symbol)}</span> ${exChip(r.exchange, r.board)} ${r.source !== "direct" ? esc(r.name) : ""}`;
    if (run) analyze();
  }

  /* ---------- controls ---------- */
  const thInputs = [$("#thDaily"), $("#thWeekly"), $("#thMonthly")];
  const onInputs = [$("#onDaily"), $("#onWeekly"), $("#onMonthly")];
  const FRAME_KEYS = ["daily", "weekly", "monthly"];
  const FRAME_NAMES = { daily: "Daily", weekly: "Weekly", monthly: "Monthly" };
  function syncFrameToggles() {
    onInputs.forEach((cb, i) => {
      thInputs[i].disabled = !cb.checked;
      cb.closest(".frame-ctl").classList.toggle("off", !cb.checked);
    });
  }
  onInputs.forEach((cb) => cb.addEventListener("change", () => {
    if (!onInputs.some((x) => x.checked)) cb.checked = true; // keep at least one frame
    syncFrameToggles();
  }));
  syncFrameToggles();
  /** Frames that were analysed in the current result. */
  const activeFrames = () => FRAME_KEYS.filter((f) => state.data?.params.thresholds[f] > 0);
  function syncFrameSegs() {
    const act = activeFrames();
    if (!act.includes(state.frame)) state.frame = act[0];
    if (!act.includes(state.chartFrame)) state.chartFrame = act[0];
    for (const [id, key] of [["#frameSeg", "frame"], ["#chartFrameSeg", "chartFrame"]]) {
      $$(`${id} button`).forEach((b) => {
        b.hidden = !act.includes(b.dataset.frame);
        b.classList.toggle("on", b.dataset.frame === state[key]);
      });
    }
  }
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
  segBind("#frameSeg", "frame", () => { state.page = 0; renderTable(); renderYears(); renderDriverDNA(); });
  function renderDriverDNA() {
    $("#dna").innerHTML = driverDNA() + `<p class="muted" style="margin-top:16px">Click <b>Scan news</b> to read the headlines behind the biggest ${state.frame} moves. Company news (orders, monthly sales, results, USFDA, block deals…) is checked for stock-specific moves, and sector/market news for the rest.</p>`;
  }
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
    const [d, w, m] = thInputs.map((i, n) => (onInputs[n].checked ? +i.value || 0 : 0));
    if (!(d > 0 || w > 0 || m > 0)) { status("Turn on at least one of daily / weekly / monthly and give it a threshold above 0.", true); return; }
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
    syncFrameSegs();
    renderCompany(); renderIndustry(); renderTiles(); renderPriceChart(); renderSigmaChart(); renderYears(); renderTable();
    renderDriverDNA();
    setTimeout(() => $("#results").scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  function renderCompany() {
    const d = state.data, info = d.info || {}, last = d.series[d.series.length - 1], prev = d.series[d.series.length - 2];
    const chg = prev ? last.c / prev.c - 1 : null;
    $("#coName").textContent = info.name || d.symbol;
    $("#coMeta").innerHTML = `
      <span class="chip">${esc(d.symbol)}</span>${exChip(d.exchange, d.board)}
      ${info.sector ? `<span>${esc(info.sector)}${info.industry ? " · " + esc(info.industry) : ""}</span>` : ""}
      <span class="muted">· data since ${fmtDate(d.firstDate)} (${d.listedYears}y)</span>`;
    const ctx = [d.benchmark.available && d.benchmark.name, d.sectorIndex?.available && d.sectorIndex.name,
      ...d.factorsTracked.filter((f) => f.available).map((f) => f.name)].filter(Boolean);
    const peerTip = d.sectorIndex?.peers ? ` title="Equal-weighted daily basket: ${esc(d.sectorIndex.peers.join(", "))}"` : "";
    $("#coMeta").innerHTML += `<div class="ctx-line">Compared against: ${ctx.map((c) => `<span class="chip"${c === d.sectorIndex?.name ? peerTip : ""}>${esc(c)}</span>`).join("") || `<span class="muted">market data unavailable</span>`}</div>`;
    if (d.sectorIndex?.peers) $("#coMeta").innerHTML += `<div class="ctx-line muted">Sector proxy = equal-weighted ${esc(d.sectorIndex.peers.join(", "))} (Yahoo has no daily NIFTY index for this sector)</div>`;
    $("#playbook").innerHTML = `Industry: <span class="chip cat">${esc(d.industry.name)}</span>`;
    const cs = d.currentSigma;
    $("#coRight").innerHTML = `
      <div class="px">₹${num(last.c)}</div>
      <div class="${cls(chg)}" style="font-family:var(--mono)">${pct(chg)} <span class="muted">${fmtDate(last.t)}</span></div>
      <div class="sig">${d.params.sigmaYears}y σ · day ${pct(cs.daily, 2).replace("+", "")} · wk ${pct(cs.weekly, 1).replace("+", "")} · mo ${pct(cs.monthly, 1).replace("+", "")}</div>`;
  }

  function renderIndustry() {
    const d = state.data, ind = d.industry;
    $("#industryName").textContent = `— ${ind.name}`;
    $("#indRally").innerHTML = ind.rally.map((x) => `<li>${esc(x)}</li>`).join("");
    $("#indSell").innerHTML = ind.selloff.map((x) => `<li>${esc(x)}</li>`).join("");
    $("#indMetrics").innerHTML = ind.metrics.map((m) => `<span class="chip">${esc(m)}</span>`).join("");
    const icon = { tailwind: "🟢", headwind: "🔴", neutral: "🟡", context: "⚪" };
    const m = d.triggerMatrix || [];
    $("#matrixAsOf").textContent = m[0]?.asOf ? `as of ${fmtDate(m[0].asOf)}` : "";
    $("#matrix").innerHTML = m.length ? `<table class="ctx matrix"><tbody>${m.map((r) => `<tr>
        <td><b>${esc(r.name)}</b><small>${esc(r.why)}</small></td>
        <td class="${cls(r.change)}">${pct(r.change, 1)}</td>
        <td><span class="st ${r.status}">${icon[r.status]} ${r.status}</span></td></tr>`).join("")}</tbody></table>`
      : `<p class="muted">No market data.</p>`;
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
    const act = activeFrames();
    const x = s[act.find((f) => s[f]?.count) || act[0]] || {};
    const share = (v) => (v == null ? "—" : `${Math.round(v * 100)}%`);
    $("#tiles").innerHTML =
      act.map((f) => frameTile(f, FRAME_NAMES[f])).join("") +
      tile("Volume build-up before", share(x.volumeBuildupShare), `of moves had pre-week volume ≥1.5× normal`) +
      tile("Stock-specific", x.count ? share(x.drivers.stock / x.count) : "—",
        x.count ? `market-wide ${share(x.drivers.market / x.count)} · sector-wide ${share(x.drivers.sector / x.count)}` : "") +
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
    event_volume_spike: ["vol spike", ""], fear_spike: ["VIX spike", "hot"],
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
      const dateTxt = e.frame === "daily" ? fmtDate(e.end) : `${fmtDate(e.start)} → ${fmtDate(e.end)}`;
      return `<tr data-id="${e.id}">
        <td>${dateTxt}</td>
        <td class="${cls(e.change)}"><b>${pct(e.change)}</b></td>
        <td>${e.zScore == null ? "—" : num(Math.abs(e.zScore), 1) + "σ"}</td>
        <td>${driverChip(e.driver)}</td>
        <td class="${cls(e.benchmarkChange)}">${pct(e.benchmarkChange, 1)}</td>
        <td class="${cls(e.sectorChange)}">${pct(e.sectorChange, 1)}</td>
        <td class="${cls(e.pre.change)}">${pct(e.pre.change, 1)}</td>
        <td>${times(e.pre.volumeRatio)}</td>
        <td>${times(e.eventVolumeRatio)}</td>
        <td class="${cls(e.postChange)}">${pct(e.postChange, 1)}</td>
        <td><div class="flags">${e.episodes.slice(0, 1).map((x) => `<span class="flag ep" title="${esc(x.name)}">${esc(x.name.length > 22 ? x.name.slice(0, 21) + "…" : x.name)}</span>`).join("")}${notableFactors(e).slice(0, 2).map((f) => `<span class="flag fx">${esc(f.name)} ${pct(f.change, 0)}</span>`).join("")}${e.flags.filter((f) => FLAG_TXT[f]).map((f) => `<span class="flag ${FLAG_TXT[f][1]}">${FLAG_TXT[f][0]}</span>`).join("")}</div></td>
        <td class="trig">${(() => { const t = triggerOf(e); return t ? esc(t.text) : `<span class="muted">open ›</span>`; })()}</td>
      </tr>`;
    }).join("") : `<tr><td colspan="12" class="muted" style="text-align:center;font-family:Inter">No events at this threshold — try lowering it.</td></tr>`;
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
    const head = ["frame", "start", "end", "direction", "change_pct", "z_score", "driver", "market_change_pct", "sector_change_pct", "pre_week_change_pct", "pre_week_volume_x", "move_volume_x", "next5d_pct", "episodes", "notable_factors", "flags", "likely_trigger"];
    const p = (x) => (x == null ? "" : (x * 100).toFixed(2));
    const q = (x) => `"${String(x).replace(/"/g, '""')}"`;
    const lines = evs.map((e) => [e.frame, e.start, e.end, e.direction, p(e.change), e.zScore ?? "", e.driver, p(e.benchmarkChange), p(e.sectorChange), p(e.pre.change),
      e.pre.volumeRatio ?? "", e.eventVolumeRatio ?? "", p(e.postChange), q(e.episodes.map((x) => x.name).join("; ")),
      q(notableFactors(e).map((f) => `${f.name} ${p(f.change)}%`).join("; ")), e.flags.join("|"), q(triggerOf(e)?.text ?? "")].join(","));
    const blob = new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `${state.data.symbol}-${state.frame}-moves.csv` });
    a.click(); URL.revokeObjectURL(a.href);
  });

  /* ---------- news ---------- */
  /** Company headlines first; market / sector / commodity headlines when withContext. */
  async function loadNews(ev, withContext = true) {
    const have = state.news.get(ev.id);
    if (have && (have.full || !withContext)) return have;
    const info = state.data.info || {};
    const n = await engine.news({
      symbol: state.data.symbol, name: info.name || state.data.symbol, start: ev.start, end: ev.end,
      sector: info.sector || "", industry: info.industry || "",
      extra: withContext ? engine.contextQueries(ev, state.data) : [],
    });
    n.full = withContext || !engine.contextQueries(ev, state.data).length;
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
    const sn = state.data.sectorIndex?.name;
    const zs = (z) => (z == null ? "" : ` (${num(Math.abs(z), 1)}σ)`);
    if (e.driver === "market") out.push(`<b>Market-wide:</b> ${esc(bn)} moved ${pct(e.benchmarkChange, 1)}${zs(e.benchmarkZ)} over the same period — the stock moved with the whole market.`);
    else if (e.driver === "sector") out.push(`<b>Sector-wide:</b> ${esc(sn)} moved ${pct(e.sectorChange, 1)}${zs(e.sectorZ)} while ${esc(bn)} moved ${pct(e.benchmarkChange, 1)} — a sector move, not just this company.`);
    else if (e.benchmarkChange != null) out.push(`<b>Stock-specific:</b> ${esc(bn)} moved ${pct(e.benchmarkChange, 1)}${e.sectorChange != null ? `, ${esc(sn)} ${pct(e.sectorChange, 1)}` : ""} — look for company news.`);
    for (const f of notableFactors(e)) if (!f.explains) out.push(`<b>${esc(f.name)}</b> moved ${pct(f.change, 1)}${zs(f.z)} in the same period.`);
    const vix = (e.factors || []).find((f) => f.kind === "vol");
    if (vix && Math.abs(vix.change) >= 0.15) out.push(`<b>India VIX</b> ${vix.change > 0 ? "jumped" : "fell"} ${pct(vix.change, 0)} — ${vix.change > 0 ? "market-wide fear" : "fear subsiding"}.`);
    if (e.episodes.length) out.push(`Falls in a known market episode: <b>${e.episodes.map((x) => esc(x.name)).join(", ")}</b>.`);
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

  /** Event -> Industry -> Trigger -> Direction, at macro, industry and company level. */
  function chainHtml(e, n) {
    const d = state.data, ind = d.industry.name, dirTxt = e.direction === "up" ? "rally" : "sell-off";
    const B = (k) => d.buckets[k]?.label || k;
    const T = (k) => d.buckets[k]?.tier || "";
    const levels = [];
    // Macro
    const macro = [];
    for (const x of e.episodes) macro.push(`<b>${esc(x.name)}</b> <span class="muted">(${esc(x.kind)})</span>`);
    if (e.driver === "market") macro.push(`${esc(d.benchmark.name)} ${pct(e.benchmarkChange, 1)} — the whole market moved`);
    for (const f of e.factors.filter((f) => f.explains)) {
      macro.push(`<b>${esc(f.name)} ${pct(f.change, 1)}</b> (${num(Math.abs(f.z), 1)}σ) → ${f.sens * f.change > 0 ? "tailwind" : "headwind"} for ${esc(ind)} <span class="muted">(${esc(f.why)})</span>`);
    }
    const vix = e.factors.find((f) => f.kind === "vol");
    if (vix && Math.abs(vix.change) >= 0.15) macro.push(`India VIX ${pct(vix.change, 0)} — ${vix.change > 0 ? "risk-off" : "risk-on"}`);
    const ctxNews = (scope) => (n?.items || []).filter((it) => it.scope === scope);
    const bucketsOf = (items) => {
      const c = {};
      for (const it of items) for (const b of it.buckets || []) c[b] = (c[b] || 0) + 1;
      return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 3);
    };
    for (const [b, c] of bucketsOf(ctxNews("market"))) macro.push(`Market news: <b>${esc(B(b))}</b> ×${c} <span class="muted">${esc(T(b))}</span>`);
    levels.push(["Macro", macro]);
    // Industry
    const indL = [];
    if (e.sectorChange != null) indL.push(`${esc(d.sectorIndex?.name || "Sector")} ${pct(e.sectorChange, 1)}${e.driver === "sector" ? " — sector-wide move" : ""}`);
    for (const [b, c] of bucketsOf(ctxNews("sector"))) indL.push(`Sector / commodity news: <b>${esc(B(b))}</b> ×${c} <span class="muted">${esc(T(b))}</span>`);
    levels.push([`Industry · ${esc(ind)}`, indL]);
    // Company
    const coL = [];
    const co = ctxNews("company");
    if (n?.likelyTrigger) coL.push(`Most headlines: <b>${esc(label(n.likelyTrigger))}</b>`);
    for (const [b, c] of bucketsOf(co)) {
      const tone = co.filter((it) => it.buckets.includes(b)).reduce((a, it) => a + it.tone, 0);
      coL.push(`<b>${esc(B(b))}</b> ×${c} ${tone > 0 ? '<span class="pos">▲ bullish tone</span>' : tone < 0 ? '<span class="neg">▼ bearish tone</span>' : ""} <span class="muted">${esc(T(b))}</span>`);
    }
    if (!n) coL.push(`<span class="muted">loading headlines…</span>`);
    levels.push(["Company", coL]);
    const verdict = triggerOf(e);
    return `<div class="chain">${levels.map(([title, items]) => `<div class="lvl"><div class="lvl-t">${title}</div>${items.length ? items.map((x) => `<div class="lvl-i">${x}</div>`).join("") : `<div class="lvl-i muted">nothing notable</div>`}</div>`).join('<div class="arrow">↓</div>')}
      <div class="verdict">→ ${e.direction === "up" ? "▲" : "▼"} ${esc(dirTxt)} of ${pct(e.change, 1)}${verdict ? ` · most likely: <b>${esc(verdict.text)}</b>` : ""}</div></div>`;
  }

  function contextHtml(e) {
    const d = state.data;
    const rows = [
      d.benchmark.available && { name: d.benchmark.name, why: "broad market", change: e.benchmarkChange, z: e.benchmarkZ, pre: e.benchmarkPreChange },
      d.sectorIndex?.available && { name: d.sectorIndex.name, why: "sector index", change: e.sectorChange, z: e.sectorZ, pre: e.sectorPreChange },
      ...(e.factors || []).map((f) => ({ name: f.name, why: f.why, change: f.change, z: f.z, pre: f.preChange })),
    ].filter((r) => r && r.change != null);
    if (!rows.length) return `<p class="muted">No market, sector or commodity data for this period.</p>`;
    return `${e.episodes.length ? `<div class="row" style="margin-bottom:10px">${e.episodes.map((x) => `<span class="chip ep">${esc(x.name)}</span>`).join("")}</div>` : ""}
      <table class="ctx"><thead><tr><th></th><th>Same period</th><th>σ</th><th>Week before</th></tr></thead><tbody>
      ${rows.map((r) => `<tr class="${Math.abs(r.z ?? 0) >= 2 ? "hot" : ""}"><td><b>${esc(r.name)}</b><small>${esc(r.why)}</small></td>
        <td class="${cls(r.change)}">${pct(r.change, 1)}</td><td>${r.z == null ? "—" : num(Math.abs(r.z), 1) + "σ"}</td>
        <td class="${cls(r.pre)}">${r.pre === undefined ? "" : pct(r.pre, 1)}</td></tr>`).join("")}
      </tbody></table>`;
  }

  function newsHtml(n, pending) {
    const link = n.link ? `<a class="btn ghost news-link" href="${esc(n.link)}" target="_blank" rel="noopener">Google News for ${fmtDate(n.window.from)} – ${fmtDate(n.window.to)} ↗</a>` : "";
    const note = n.archiveNote ? `<p class="muted" style="font-size:12.5px">${esc(n.archiveNote)}</p>` : "";
    const more = pending ? `<p class="muted" style="font-size:12.5px"><span class="spinner"></span>Adding market &amp; sector headlines… (the free news archive allows one request every 5 seconds)</p>` : "";
    if (!n.items.length) return `<p class="muted">No headlines found automatically for ${fmtDate(n.window.from)} – ${fmtDate(n.window.to)}.</p>${note}${more}${link}`;
    const counts = Object.entries(n.categoryCounts).sort((a, b) => b[1] - a[1]);
    const item = (it) => `<a class="news-item" href="${esc(it.url)}" target="_blank" rel="noopener">
        <div class="t">${esc(it.title)}</div>
        <div class="m">${it.tone > 0 ? '<span class="pos">▲</span>' : it.tone < 0 ? '<span class="neg">▼</span>' : ""} ${it.date ? fmtDate(it.date) : ""} ${it.source ? "· " + esc(it.source) : ""} ${(it.buckets || []).slice(0, 3).map((b) => `<span class="chip cat">${esc(state.data.buckets[b]?.label || b)}</span>`).join("")}</div>
      </a>`;
    const group = (scope, title) => {
      const items = n.items.filter((it) => (it.scope || "company") === scope);
      return items.length ? `<div class="news-group">${title}</div>${items.map(item).join("")}` : "";
    };
    return `<div class="row" style="margin-bottom:10px">${counts.map(([k, c]) => `<span class="chip cat">${esc(label(k))} · ${c}</span>`).join("")}</div>` +
      group("company", "Company") + group("sector", "Sector &amp; commodities") + group("market", "Market &amp; macro") + more + note + link;
  }

  async function openEvent(e) {
    const dateTxt = e.frame === "daily" ? fmtDate(e.end) : `${fmtDate(e.start)} → ${fmtDate(e.end)}`;
    $("#drawerBody").innerHTML = `
      <div class="dw-title">${e.frame} move · ${dateTxt}</div>
      <div class="dw-move ${cls(e.change)}">${pct(e.change)}</div>
      <div class="dw-sub">₹${num(e.prevClose)} → ₹${num(e.close)} ${e.zScore != null ? `· <b>${num(Math.abs(e.zScore), 1)}σ</b> vs trailing ${state.data.params.sigmaYears}y` : ""}</div>
      <div style="margin-top:10px">${driverChip(e.driver)}</div>
      <div class="kv">
        <div><small>Pre-week</small><b class="${cls(e.pre.change)}">${pct(e.pre.change, 1)}</b></div>
        <div><small>Pre-vol ×</small><b>${times(e.pre.volumeRatio)}</b></div>
        <div><small>Move vol ×</small><b>${times(e.eventVolumeRatio)}</b></div>
        <div><small>${esc(state.data.benchmark.name)}</small><b class="${cls(e.benchmarkChange)}">${pct(e.benchmarkChange, 1)}</b></div>
        <div><small>${esc(state.data.sectorIndex?.name || "Sector")}</small><b class="${cls(e.sectorChange)}">${pct(e.sectorChange, 1)}</b></div>
        <div><small>Next 5d</small><b class="${cls(e.postChange)}">${pct(e.postChange, 1)}</b></div>
      </div>
      <div class="section-t">The week before → the move <button class="btn ghost" id="zoomBtn" style="padding:5px 10px;font-size:12px">Show on chart</button></div>
      ${miniChart(e)}
      <div class="section-t">Trigger chain <span class="muted" style="font-weight:400">event → industry → trigger → direction</span></div>
      <div id="chainBox">${chainHtml(e, state.news.get(e.id))}</div>
      <div class="section-t">What else moved <span class="muted" style="font-weight:400">σ = vs its own trailing 1y volatility</span></div>
      ${contextHtml(e)}
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
    const show = (n, pending) => {
      if (!drawer.classList.contains("open") || drawer.dataset.ev !== e.id) return;
      $("#newsBox").innerHTML = newsHtml(n, pending);
      $("#chainBox").innerHTML = chainHtml(e, n);
      const t = triggerOf(e);
      $("#likely").innerHTML = t ? `likely: <b style="color:var(--ink)">${esc(t.text)}</b>` : "";
    };
    drawer.dataset.ev = e.id;
    try {
      const wantsContext = engine.contextQueries(e, state.data).length > 0;
      const first = await loadNews(e, false);
      show(first, wantsContext && !first.full);
      if (wantsContext && !first.full) show(await loadNews(e, true), false);
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
    $("#dna").innerHTML = `<div class="muted">Scanning news for the ${evs.length} largest ${state.frame} moves… the free news archive allows one request every 5 seconds, so this takes about ${Math.ceil((evs.length * 5.2) / 60)} min.</div><div class="progress"><div style="width:0%"></div></div>`;
    const queue = [...evs];
    const worker = async () => {
      while (queue.length) {
        const e = queue.shift();
        try { await loadNews(e, false); } catch { /* skip */ }
        done++;
        const bar = $("#dna .progress div"); if (bar) bar.style.width = `${(done / evs.length) * 100}%`;
      }
    };
    await Promise.all([worker(), worker()]);
    btn.disabled = false;
    renderDNA(evs);
    renderTable();
  });

  /** Market / sector / stock split plus episodes & commodities — needs no news, shown right away. */
  function driverDNA() {
    const s = state.data.summary[state.frame];
    if (!s?.count) return `<p class="muted">No ${state.frame} events.</p>`;
    const bars = (counts, dir) => {
      const tot = counts.market + counts.sector + counts.stock;
      if (!tot) return `<p class="muted">None.</p>`;
      return ["market", "sector", "stock"].map((k) => `<div class="bar-row"><span>${DRIVER[k]}</span><div class="track"><div class="fill ${dir}" style="width:${(counts[k] / tot) * 100}%"></div></div><b>${Math.round((counts[k] / tot) * 100)}%</b></div>`).join("");
    };
    const list = (items, empty) => items.length ? items.map((x) => `<span class="chip">${esc(x.name)} · ${x.count}</span>`).join("") : `<span class="muted">${empty}</span>`;
    return `<div class="dna-grid">
        <div><h3><span class="pos">▲</span> What drove up-moves (${s.up})</h3>${bars(s.driversUp, "up")}</div>
        <div><h3><span class="neg">▼</span> What drove down-moves (${s.down})</h3>${bars(s.driversDown, "down")}</div>
      </div>
      <div class="dna-grid" style="margin-top:16px">
        <div><h3>Market episodes behind moves</h3><div class="row">${list(s.topEpisodes, "none of the curated episodes")}</div></div>
        <div><h3>Macro moves that explain them <span class="muted">(given ${esc(state.data.industry.name)} sensitivities)</span></h3><div class="row">${list(s.explainingFactors, "none ≥1.5σ in the right direction")}</div></div>
      </div>`;
  }

  function renderDNA(evs) {
    const agg = { up: {}, down: {} }, tot = { up: 0, down: 0 };
    for (const e of evs) {
      const t = triggerOf(e); if (!t) continue;
      agg[e.direction][t.key] = (agg[e.direction][t.key] || 0) + 1; tot[e.direction]++;
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
    // Framework view: which master trigger buckets show up in the news around rallies vs sell-offs.
    const bk = { up: {}, down: {} };
    for (const e of evs) {
      const n = state.news.get(e.id); if (!n) continue;
      for (const [b, c] of Object.entries(n.bucketCounts || {})) bk[e.direction][b] = (bk[e.direction][b] || 0) + Math.min(c, 3);
    }
    const bblock = (dir) => {
      const rows = Object.entries(bk[dir]).sort((a, b) => b[1] - a[1]).slice(0, 8);
      if (!rows.length) return `<p class="muted">No headlines.</p>`;
      const max = rows[0][1];
      return rows.map(([k, c]) => `<div class="bar-row"><span>${esc(state.data.buckets[k]?.label || k)}<small class="muted"> · ${esc((state.data.buckets[k]?.tier || "").split(" ")[0])}</small></span><div class="track"><div class="fill ${dir}" style="width:${(c / max) * 100}%"></div></div><b>${c}</b></div>`).join("");
    };
    $("#dna").innerHTML = driverDNA() + `<h3 style="margin-top:22px">Trigger buckets in the news (master framework)</h3><div class="dna-grid">
        <div><h3><span class="pos">▲</span> Around rallies</h3>${bblock("up")}</div>
        <div><h3><span class="neg">▼</span> Around sell-offs</h3>${bblock("down")}</div>
      </div><h3 style="margin-top:22px">Most likely trigger of each of the ${evs.length} biggest moves</h3><div class="dna-grid">
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
    status(v ? "Using your relay. Search again to load data." : "Relay removed.");
    if (!v && !engine.relayUrl()) showRelaySetup(false); else $("#relaySetup").hidden = true;
  });
  $("#proxyCancel").addEventListener("click", (e) => { e.preventDefault(); dlg.close(); });

  $("#relayInlineSave").addEventListener("click", () => {
    const v = $("#relayInline").value.trim();
    if (!/^https:\/\/.+/.test(v)) { $("#relayInlineMsg").textContent = "Paste the worker URL — it starts with https://"; return; }
    engine.setCustomProxy(v);
    $("#relaySetup").hidden = true;
    status("Relay connected. Search for a company to load live data.");
  });

  /* ---------- boot ---------- */
  if (!engine.isDemo && !engine.relayUrl()) showRelaySetup(false);
  $("#demoBadge").hidden = !engine.isDemo;
  const fromHash = decodeURIComponent(location.hash.slice(1));
  if (fromHash) choose({ symbol: fromHash.toUpperCase(), name: fromHash.toUpperCase(), exchange: "", board: "", source: "direct" }, true);
}
