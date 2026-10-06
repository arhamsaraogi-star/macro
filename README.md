# macro — stock move forensics (NSE · BSE · SME)

![macro screenshot (demo data)](docs/screenshot-demo.png)

Search any Indian listed company, pick its ticker, and the site will:

1. **Pull up to 20 years (or the full listed history)** of daily prices & volumes from Yahoo Finance (split/bonus adjusted).
2. **Find every big move**, daily, weekly and monthly, using either:
   - **% move**: e.g. ±5% in a day, a week or a month, or
   - **σ move**: e.g. a 2σ move, where σ is the trailing standard deviation of that frame's returns over a 1/2/3/5-year lookback. The current period is excluded, so there's no look-ahead.
3. **Look at the week before each move** (5 sessions before the period starts):
   - price drift in the same or the opposite direction
   - volume build-up vs the 50-day baseline before that week (≥1.5× is flagged)
   - volume during the move, the index (NIFTY 50 / SENSEX) move over the same period (market-driven or stock-specific), and the next 5 sessions (follow-through or reversal)
4. **Pull the news around the move** (from 1 week before to 2 days after) and tag each headline as a trigger type: order wins, monthly sales, results, guidance/capex, dividends/bonus/splits, M&A/promoter activity, QIP/block deals, broker calls, regulatory/USFDA/policy, management change, or macro.
5. **Trigger DNA** scans the news behind the N biggest moves and shows what usually moves *this* stock. For example, orders for capital goods companies and monthly sales numbers for autos. The sector's typical triggers are shown as a "playbook".

There is also a daily returns vs ±kσ bands chart (with the breach rate vs what a normal distribution would give), a chart of big moves by year, an event table you can sort and filter, CSV export, and shareable URLs (`/#LT.NS`).

## Tickers

| Market | Yahoo format | Example |
|---|---|---|
| NSE main board | `SYMBOL.NS` | `LT.NS`, `TATAMOTORS.NS` |
| NSE Emerge (SME) | `SYMBOL-SM.NS` / `SYMBOL-ST.NS` | `XYZ-SM.NS` |
| BSE (main + SME) | `CODE.BO` or `SYMBOL.BO` | `500325.BO` |

Type a company name to get the matching tickers with NSE/BSE/SME badges. You can also type a raw symbol in caps or a 6-digit BSE code. Without a suffix, the app tries `.NS`, then `.BO`, then the SME variants.

## Hosting (GitHub Pages)

The site is fully static: all analysis runs in the visitor's browser, so it is hosted on GitHub Pages with no server.

- **Live URL:** https://arhamsaraogi-star.github.io/macro/
- **Demo with synthetic data:** https://arhamsaraogi-star.github.io/macro/?demo=1
- **Deploys:** `.github/workflows/pages.yml` runs the tests and publishes `site/` on every push to the default branch.
- **One-time setup:** if the first deploy fails with a Pages error, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**, then re-run the workflow.

### Data relay

Yahoo Finance and Google News don't allow direct calls from other websites (no CORS headers), so the browser fetches them through a relay:

1. **By default:** a chain of free public CORS relays (allorigins, codetabs, corsproxy.io). This needs no setup, but they can be slow, rate-limited or down.
2. **Recommended:** your own free Cloudflare Worker.
   - Go to [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → **Worker**.
   - Paste [`relay/worker.js`](relay/worker.js) and click **Deploy**.
   - Copy the `https://….workers.dev` URL and paste it into the site's **Settings** (gear icon, top right).

   The worker only forwards requests to Yahoo Finance and Google News, caches them for 1 hour, and the free tier allows 100k requests a day. The relay URL is saved in your browser only.

## Develop

```bash
python3 -m http.server -d site 8000   # open http://localhost:8000 (add ?demo=1 to work offline)
npm test                              # node --test, no dependencies
```

## Structure

```
site/
  index.html, styles.css     liquid-glass UI
  js/app.js                  UI: search, charts, event drawer, trigger DNA, CSV
  js/engine.js               data API used by the UI (live or demo)
  js/analysis.js             period returns, % / σ thresholds, pre-week forensics, summaries
  js/market.js               Yahoo search/chart + Google News through the relay chain
  js/news.js                 headline -> trigger classification, sector playbooks
  js/demo.js                 synthetic data for ?demo=1
  vendor/                    TradingView lightweight-charts (Apache-2.0)
relay/worker.js              optional Cloudflare Worker relay
tests/                       node:test unit tests
```

## Caveats

- Yahoo Finance is unofficial. Coverage of SME stocks and very old history can be patchy, and some SME counters only exist on one exchange.
- BSE SME stocks can't be told apart from BSE main-board stocks by their Yahoo ticker, so they show as BSE.
- Google News coverage before ~2010 and for small companies is thin. The trigger classification uses keyword rules, so treat it as a lead to read the headlines, not a verdict.
- Not investment advice.
