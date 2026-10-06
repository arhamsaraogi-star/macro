"""Historical news lookup around a price move, plus headline -> trigger classification.

Google News RSS supports ``after:YYYY-MM-DD before:YYYY-MM-DD`` operators, which lets
us pull headlines for an arbitrary historical window (coverage is thinner before
~2010). Each headline is tagged with the kind of catalyst it most likely represents.
"""

from __future__ import annotations

import re
from datetime import date, timedelta
from email.utils import parsedate_to_datetime
from urllib.parse import quote_plus

import feedparser
import httpx

from . import demo
from .market import TTLCache

_news_cache = TTLCache(ttl=60 * 60 * 24, max_items=2048)

# All matching categories are kept; PRIORITY decides the "primary" one (specific beats generic).
CATEGORIES: list[tuple[str, str, list[str]]] = [
    ("results", "Quarterly results / earnings", [
        r"\bq[1-4]\b", r"results?", r"earnings", r"net profit", r"\bprofit\b", r"\bpat\b", r"ebitda",
        r"revenue", r"margin", r"quarter", r"\bloss\b", r"beats? estimates", r"misses? estimates",
    ]),
    ("orders", "Order wins / contracts", [
        r"\border(s)?\b", r"order book", r"contract", r"\bbags?\b", r"\bwins?\b.*(project|deal|order)",
        r"\bl1\b", r"tender", r"letter of (award|intent)", r"\bloa\b", r"\bproject\b",
    ]),
    ("sales", "Monthly sales / business update", [
        r"\bsales\b", r"despatch", r"dispatch", r"volumes?", r"\bunits\b", r"business update",
        r"deliveries", r"registrations", r"loan growth", r"deposits? growth", r"\baum\b",
    ]),
    ("guidance", "Guidance / management commentary", [
        r"guidance", r"outlook", r"forecast", r"\btargets?\b.*(fy|revenue|growth)", r"capex",
        r"expansion", r"capacity", r"commission(s|ed|ing)", r"new plant", r"launch",
    ]),
    ("corporate_action", "Dividend / bonus / split / buyback", [
        r"dividend", r"bonus", r"split", r"buy-?back", r"record date", r"rights issue",
    ]),
    ("deal", "M&A / stake sale / promoter activity", [
        r"acqui", r"merger", r"amalgamat", r"demerg", r"stake", r"promoter", r"takeover",
        r"open offer", r"joint venture", r"\bjv\b", r"divest", r"pledge",
    ]),
    ("fundraise", "Fund raise / block deals / index changes", [
        r"\bqip\b", r"\bipo\b", r"\bofs\b", r"fund ?rais", r"preferential", r"block deal", r"bulk deal",
        r"\bfii\b", r"\bfpi\b", r"\bmsci\b", r"index inclusion", r"\bstake buy", r"mutual fund",
    ]),
    ("rating", "Broker calls / credit ratings", [
        r"upgrade", r"downgrade", r"target price", r"\bbuy\b", r"\bsell\b", r"outperform",
        r"underperform", r"rating", r"brokerage", r"\bcrisil\b", r"\bicra\b", r"\bcare\b",
    ]),
    ("regulatory", "Regulatory / legal / government policy", [
        r"\bsebi\b", r"\brbi\b", r"usfda", r"\bfda\b", r"warning letter", r"import alert", r"court",
        r"tribunal", r"\bnclt\b", r"penalty", r"probe", r"raid", r"\bban\b", r"policy", r"\bpli\b",
        r"tariff", r"duty", r"gst", r"budget", r"approval", r"licen[cs]e", r"govt|government",
    ]),
    ("management", "Management change / governance", [
        r"\bceo\b", r"\bcfo\b", r"\bmd\b", r"chairman", r"resign", r"appoint", r"steps down",
        r"auditor", r"fraud", r"governance", r"whistle",
    ]),
    ("macro", "Market-wide / macro / commodity", [
        r"sensex", r"nifty", r"market(s)? (crash|rally|fall|surge)", r"crude", r"oil price",
        r"rupee", r"inflation", r"rate (cut|hike)", r"\bfed\b", r"global", r"steel price",
        r"metal prices?", r"monsoon", r"election",
    ]),
]
_COMPILED = [(key, label, [re.compile(p, re.I) for p in pats]) for key, label, pats in CATEGORIES]
PRIORITY = ["corporate_action", "deal", "fundraise", "orders", "sales", "guidance", "management",
            "regulatory", "results", "rating", "macro"]
CATEGORY_LABELS = {key: label for key, label, _ in CATEGORIES} | {"other": "Other / general"}

# What usually moves stocks in a sector -> shown as a "playbook" and used to weight news.
SECTOR_PLAYBOOK = {
    "industrials": ["orders", "results", "guidance", "regulatory"],
    "capital goods": ["orders", "results", "guidance"],
    "consumer cyclical": ["sales", "results", "guidance", "regulatory"],
    "auto": ["sales", "results", "regulatory"],
    "financial services": ["results", "regulatory", "sales", "rating"],
    "healthcare": ["regulatory", "results", "deal"],
    "technology": ["results", "guidance", "orders", "deal"],
    "basic materials": ["macro", "results", "guidance", "regulatory"],
    "energy": ["macro", "regulatory", "results"],
    "utilities": ["regulatory", "orders", "results"],
    "real estate": ["sales", "results", "regulatory"],
    "consumer defensive": ["results", "macro", "guidance"],
    "communication services": ["regulatory", "results", "deal"],
}


def playbook(sector: str, industry: str = "") -> list[str]:
    text = f"{sector} {industry}".lower()
    if "auto" in text:
        return SECTOR_PLAYBOOK["auto"]
    for key, cats in SECTOR_PLAYBOOK.items():
        if key in text:
            return cats
    return ["results", "orders", "sales", "deal"]


def classify(title: str) -> list[str]:
    cats = [key for key, _, pats in _COMPILED if any(p.search(title) for p in pats)]
    return sorted(cats, key=PRIORITY.index) or ["other"]


_SUFFIXES = re.compile(r"\b(limited|ltd\.?|ltd|private|pvt\.?|inc\.?|corporation|corp\.?|company|co\.)\s*$", re.I)


def clean_company_name(name: str) -> str:
    name = re.sub(r"\s+", " ", name or "").strip()
    for _ in range(2):
        name = _SUFFIXES.sub("", name).strip(" ,.-")
    return name


def _google_news(query: str, after: date, before: date) -> list[dict]:
    q = f"{query} after:{after.isoformat()} before:{before.isoformat()}"
    url = f"https://news.google.com/rss/search?q={quote_plus(q)}&hl=en-IN&gl=IN&ceid=IN:en"
    resp = httpx.get(url, timeout=12, follow_redirects=True, headers={"User-Agent": "Mozilla/5.0"})
    resp.raise_for_status()
    feed = feedparser.parse(resp.text)
    items = []
    for entry in feed.entries:
        title = entry.get("title", "")
        source = (entry.get("source") or {}).get("title", "")
        if source and title.endswith(f" - {source}"):
            title = title[: -len(source) - 3]
        try:
            published = parsedate_to_datetime(entry.get("published")).date().isoformat()
        except Exception:
            published = None
        items.append({"title": title, "url": entry.get("link"), "source": source, "date": published})
    return items


def fetch(company: str, symbol: str, start: str, end: str, sector: str = "", industry: str = "") -> dict:
    """Headlines from one week before ``start`` to two days after ``end``."""
    d0 = date.fromisoformat(start) - timedelta(days=8)
    d1 = date.fromisoformat(end) + timedelta(days=3)
    name = clean_company_name(company)
    key = (name.lower(), symbol, d0, d1)
    cached = _news_cache.get(key)
    if cached is not None:
        return cached

    if demo.enabled():
        raw, errors = demo.news(name, d0, d1), []
    else:
        raw, errors = [], []
        base = symbol.split(".")[0].replace("-SM", "").replace("-ST", "")
        queries = [f'"{name}"'] if name else []
        if not base.isdigit():
            queries.append(f'"{base}" share')
        for q in queries:
            try:
                raw.extend(_google_news(q, d0, d1))
            except Exception as exc:  # network / parse problems shouldn't kill the request
                errors.append(f"{q}: {exc.__class__.__name__}")
            if len(raw) >= 8:
                break

    preferred = set(playbook(sector, industry))
    seen, items = set(), []
    for it in raw:
        k = it["title"].lower()[:90]
        if k in seen:
            continue
        seen.add(k)
        cats = classify(it["title"])
        score = 1.0
        if any(c in preferred for c in cats):
            score += 1.0
        if cats != ["other"]:
            score += 0.5
        if it["date"]:
            # closer to the move = more relevant
            gap = abs((date.fromisoformat(it["date"]) - date.fromisoformat(start)).days)
            score += max(0.0, 1.0 - gap / 10)
        items.append({**it, "categories": cats, "primary": cats[0], "score": round(score, 2)})

    items.sort(key=lambda x: (-x["score"], x["date"] or ""))
    counts: dict[str, int] = {}
    for it in items:
        counts[it["primary"]] = counts.get(it["primary"], 0) + 1
    likely = next((c for c, _ in sorted(counts.items(), key=lambda kv: -kv[1]) if c != "other"), None)
    result = {
        "window": {"from": d0.isoformat(), "to": d1.isoformat()},
        "items": items[:25],
        "categoryCounts": counts,
        "likelyTrigger": likely,
        "errors": errors,
    }
    if not errors:
        _news_cache.set(key, result)
    return result
