// Headline -> trigger classification and sector playbooks (pure; tested in Node).
import { classifyTrigger } from "./playbooks.js";

export const CATEGORIES = [
  ["results", "Quarterly results / earnings", [
    /\bq[1-4]\b/i, /results?/i, /earnings/i, /net profit/i, /\bprofit\b/i, /\bpat\b/i, /ebitda/i,
    /revenue/i, /margin/i, /quarter/i, /\bloss\b/i, /beats? estimates/i, /misses? estimates/i,
  ]],
  ["orders", "Order wins / contracts", [
    /\border(s)?\b/i, /order book/i, /contract/i, /\bbags?\b/i, /\bwins?\b.*(project|deal|order)/i,
    /\bl1\b/i, /tender/i, /letter of (award|intent)/i, /\bloa\b/i, /\bproject\b/i,
  ]],
  ["sales", "Monthly sales / business update", [
    /\bsales\b/i, /despatch/i, /dispatch/i, /volumes?/i, /\bunits\b/i, /business update/i,
    /deliveries/i, /registrations/i, /loan growth/i, /deposits? growth/i, /\baum\b/i,
  ]],
  ["guidance", "Guidance / management commentary", [
    /guidance/i, /outlook/i, /forecast/i, /\btargets?\b.*(fy|revenue|growth)/i, /capex/i,
    /expansion/i, /capacity/i, /commission(s|ed|ing)/i, /new plant/i, /launch/i,
  ]],
  ["corporate_action", "Dividend / bonus / split / buyback", [
    /dividend/i, /bonus/i, /split/i, /buy-?back/i, /record date/i, /rights issue/i,
  ]],
  ["deal", "M&A / stake sale / promoter activity", [
    /acqui/i, /merger/i, /amalgamat/i, /demerg/i, /stake/i, /promoter/i, /takeover/i,
    /open offer/i, /joint venture/i, /\bjv\b/i, /divest/i, /pledge/i,
  ]],
  ["fundraise", "Fund raise / block deals / index changes", [
    /\bqip\b/i, /\bipo\b/i, /\bofs\b/i, /fund ?rais/i, /preferential/i, /block deal/i, /bulk deal/i,
    /\bfii\b/i, /\bfpi\b/i, /\bmsci\b/i, /index inclusion/i, /mutual fund/i,
  ]],
  ["rating", "Broker calls / credit ratings", [
    /upgrade/i, /downgrade/i, /target price/i, /\bbuy\b/i, /\bsell\b/i, /outperform/i,
    /underperform/i, /rating/i, /brokerage/i, /\bcrisil\b/i, /\bicra\b/i,
  ]],
  ["regulatory", "Regulatory / legal / government policy", [
    /\bsebi\b/i, /\brbi\b/i, /usfda/i, /\bfda\b/i, /warning letter/i, /import alert/i, /court/i,
    /tribunal/i, /\bnclt\b/i, /penalty/i, /probe/i, /raid/i, /\bban\b/i, /policy/i, /\bpli\b/i,
    /tariff/i, /duty/i, /\bgst\b/i, /budget/i, /approval/i, /licen[cs]e/i, /govt|government/i,
  ]],
  ["management", "Management change / governance", [
    /\bceo\b/i, /\bcfo\b/i, /\bmd\b/i, /chairman/i, /resign/i, /appoint/i, /steps? down/i,
    /auditor/i, /fraud/i, /governance/i, /whistle/i, /\bexit\b/i, /ouster|ousted|sack/i, /(term|tenure) (cut|curtail|trim)|curtails? .*term|trims? .*term/i,
    /hindenburg|short.?seller|accounting/i,
  ]],
  ["ai_theme", "AI / data-centre theme", [
    /\bai\b/i, /artificial intelligence/i, /gen ?ai/i, /data ?cent(er|re)/i, /hyperscaler/i, /nvidia/i, /ai (capex|bubble|slowdown|spending|demand|trade)/i,
  ]],
  ["macro", "Market-wide / macro / commodity", [
    /sensex/i, /nifty/i, /market(s)? (crash|rally|fall|surge)/i, /crude/i, /oil price/i,
    /rupee/i, /inflation/i, /rate (cut|hike)/i, /\bfed\b/i, /global/i, /steel price/i,
    /metal prices?/i, /monsoon/i, /election/i, /covid|corona|pandemic|lockdown/i, /\bwar\b|ukraine|russia|geopolit|israel|iran/i,
    /recession/i, /sell-?off/i, /bloodbath/i, /dalal street/i, /\bfpi(s)? (sell|outflow)/i, /lehman|financial crisis/i,
    /demoneti[sz]ation/i, /trump|liberation day/i, /yuan|china/i,
  ]],
];
// All matching categories are kept; PRIORITY picks the "primary" one (specific beats generic).
export const DRIVER_LABELS = { market: "Market-wide move", sector: "Sector-wide move", stock: "Stock-specific" };
const PRIORITY = ["corporate_action", "fundraise", "deal", "orders", "sales", "guidance", "management",
  "regulatory", "results", "rating", "macro"];
export const CATEGORY_LABELS = Object.fromEntries([...CATEGORIES.map(([k, l]) => [k, l]), ["other", "Other / general"]]);

const SECTOR_PLAYBOOK = {
  industrials: ["orders", "results", "guidance", "regulatory"],
  "capital goods": ["orders", "results", "guidance"],
  "consumer cyclical": ["sales", "results", "guidance", "regulatory"],
  auto: ["sales", "results", "regulatory"],
  "financial services": ["results", "regulatory", "sales", "rating"],
  healthcare: ["regulatory", "results", "deal"],
  technology: ["results", "guidance", "orders", "deal"],
  "basic materials": ["macro", "results", "guidance", "regulatory"],
  energy: ["macro", "regulatory", "results"],
  utilities: ["regulatory", "orders", "results"],
  "real estate": ["sales", "results", "regulatory"],
  "consumer defensive": ["results", "macro", "guidance"],
  "communication services": ["regulatory", "results", "deal"],
};

export function playbook(sector = "", industry = "") {
  const text = `${sector} ${industry}`.toLowerCase();
  if (text.includes("auto")) return SECTOR_PLAYBOOK.auto;
  for (const [k, cats] of Object.entries(SECTOR_PLAYBOOK)) if (text.includes(k)) return cats;
  return ["results", "orders", "sales", "deal"];
}

export function classify(title) {
  const cats = CATEGORIES.filter(([, , pats]) => pats.some((p) => p.test(title))).map(([k]) => k);
  return cats.length ? cats.sort((a, b) => PRIORITY.indexOf(a) - PRIORITY.indexOf(b)) : ["other"];
}

const SUFFIX = /\b(limited|ltd\.?|private|pvt\.?|inc\.?|corporation|corp\.?|company|co\.)\s*$/i;
export function cleanCompanyName(name = "") {
  let n = name.replace(/\s+/g, " ").trim();
  for (let i = 0; i < 2; i++) n = n.replace(SUFFIX, "").trim().replace(/^[ ,.-]+|[ ,.-]+$/g, "");
  return n;
}

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return iso(d); };

/** News window for a move: one week before the start to two days after the end. */
export function newsWindow(start, end) {
  return { from: addDays(start, -8), to: addDays(end, 3) };
}

const GENERIC_WORDS = new Set(["the", "india", "indian", "and", "of", "co", "company", "industries", "industry", "enterprises", "group", "holdings", "corporation", "international", "global", "systems", "solutions", "services", "technologies", "power", "energy", "finance", "financial", "bank", "infra", "projects", "products", "steel", "motors", "pharmaceuticals", "chemicals", "cement", "textiles"]);

/**
 * Does a headline actually mention the company? Google News date searches match loosely,
 * so company headlines must contain the distinctive part of the name or the ticker.
 */
export function mentionsCompany(title, name, ticker = "") {
  const t = ` ${title.toLowerCase().replace(/[^a-z0-9&]+/g, " ")} `;
  const words = cleanCompanyName(name).toLowerCase().replace(/[^a-z0-9& ]+/g, " ").split(/\s+/).filter(Boolean);
  if (ticker && ticker.length >= 3 && !/^\d+$/.test(ticker) && t.includes(` ${ticker.toLowerCase()} `)) return true;
  if (!words.length) return false;
  // Distinctive phrase: the first word, plus the next word(s) while the phrase is short or generic.
  const phrase = [words[0]];
  for (let i = 1; i < words.length && (phrase.join(" ").length < 5 || GENERIC_WORDS.has(phrase.at(-1))); i++) phrase.push(words[i]);
  if (GENERIC_WORDS.has(words[0]) && phrase.length === 1 && words[1]) phrase.push(words[1]);
  return t.includes(` ${phrase.join(" ")} `);
}

/** Score, dedupe and summarise raw headlines ({title,url,source,date}). */
// NSE filing types that map straight to a trigger category.
const FILING_TYPES = [
  [/financial result|results? updates?/i, "results"],
  [/raising of funds|preferential|qip|rights issue|allotment/i, "fundraise"],
  [/change in (directors|management)|key managerial|resignation|appointment|cessation/i, "management"],
  [/credit rating/i, "rating"],
  [/bagging|receiving of orders|award of order|order/i, "orders"],
  [/acquisition|amalgamation|merger|scheme of arrangement|disinvestment/i, "deal"],
  [/bonus|split|buy ?back|dividend/i, "corporate_action"],
];
const LODR_BOILERPLATE = /(disclosure )?under regulation \d+[^.;]*?(sebi \(listing obligations and disclosure requirements\) regulations,? 2015)?(,? as amended)?/gi;

export function rankNews(raw, { start, end = start, sector = "", industry = "", name = "", ticker = "" }) {
  // items carry scope: "filing" (exchange filing), "company" (default), "sector" or "market"
  const preferred = new Set(playbook(sector, industry));
  const seen = new Set();
  const items = [];
  const day = (d) => Date.parse(d + "T00:00:00Z");
  // "Fresh" = from the day before the move to the last day of the move (results often land after the close).
  const fresh = (d) => !!d && day(d) >= day(start) - 864e5 * (new Date(start).getUTCDay() === 1 ? 3 : 1) && day(d) <= day(end);
  for (let it of raw) {
    const key = it.title.toLowerCase().slice(0, 90);
    if (seen.has(key)) continue;
    // Search engines match names anywhere in the article; keep company headlines that name the company.
    if ((it.scope || "company") === "company" && name && !mentionsCompany(it.title, name, ticker)) continue;
    seen.add(key);
    const isFiling = it.scope === "filing";
    const text = isFiling ? `${it.desc || ""} ${it.title.replace(LODR_BOILERPLATE, "")}` : it.title;
    let cats = classify(text);
    if (isFiling) {
      const typed = FILING_TYPES.find(([re]) => re.test(it.desc || ""))?.[1];
      if (typed) cats = [typed, ...cats.filter((c) => c !== typed && c !== "other")];
      it = { ...it, typed: !!typed };
    }
    let score = isFiling ? 2 : 1;
    if (cats.some((c) => preferred.has(c))) score += 1;
    if (cats[0] !== "other") score += 0.5;
    if (it.date) score += Math.max(0, 1 - Math.abs(Date.parse(it.date) - Date.parse(start)) / (10 * 864e5));
    const trig = classifyTrigger(text);
    items.push({ ...it, scope: it.scope || "company", categories: cats, primary: cats[0], buckets: trig.buckets, tone: trig.tone, fresh: fresh(it.date), score: Math.round(score * 100) / 100 });
  }
  items.sort((a, b) => b.score - a.score || (a.date || "").localeCompare(b.date || ""));
  const filings = items.filter((it) => it.scope === "filing");
  const company = items.filter((it) => it.scope === "company");
  // Weight: fresh typed exchange filings 3 (the company's own disclosure, right at the move), fresh
  // headlines 1, anything older than the day before the move 0.3.
  const counts = {}, freshCounts = {};
  const add = (it, w) => {
    if (it.primary === "other") return;
    counts[it.primary] = (counts[it.primary] || 0) + w;
    if (it.fresh) freshCounts[it.primary] = (freshCounts[it.primary] || 0) + w;
  };
  for (const it of company) add(it, it.fresh ? 1 : 0.3);
  // Generic press releases / updates count like a headline; typed filings (results, management
  // change, rating, orders…) are the strongest evidence.
  for (const it of filings) add(it, it.fresh ? (it.typed ? 3 : 0.5) : 0.3);
  // Market wraps that merely mention the company ("Sensex falls; X worst performer") are "macro":
  // let specific company triggers win whenever there are any.
  const pick = (c) => {
    const ranked = Object.entries(c).sort((a, b) => b[1] - a[1]);
    return (ranked.find(([k]) => k !== "macro") || ranked[0])?.[0] ?? null;
  };
  // Only fresh evidence with real weight names the trigger; older items are reported as "earlier".
  const freshPick = pick(freshCounts);
  const likely = freshPick && freshCounts[freshPick] >= 1 ? freshPick : null;
  const earlier = !likely ? pick(counts) : null;
  const context = items.filter((it) => it.scope === "sector" || it.scope === "market").slice(0, 12);
  const buckets = {};
  for (const it of [...filings, ...company, ...context]) for (const b of it.buckets) buckets[b] = (buckets[b] || 0) + 1;
  return {
    items: [...filings.slice(0, 12), ...company.slice(0, 25), ...context],
    categoryCounts: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, Math.round(v * 10) / 10])),
    likelyTrigger: likely, likelyFresh: !!likely, earlierTrigger: earlier, bucketCounts: buckets,
  };
}
