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

Type a company name to get the matching tickers with NSE/BSE/SME badges. You can also type a raw symbol or a 6-digit BSE code. Without a suffix, the app tries `.NS`, then `.BO`, then the SME variants.

## Run it

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
# open http://127.0.0.1:8000
```

Offline demo with synthetic data (no network needed):

```bash
MACRO_DEMO=1 uvicorn app.main:app
```

Tests: `pytest -q`

## API

- `GET /api/search?q=larsen` returns candidate tickers (NSE first, then BSE).
- `GET /api/analyze?symbol=LT.NS&mode=percent&daily=5&weekly=5&monthly=5&years=20`
  - `mode=sigma&daily=2&sigma_years=1` gives 2σ moves vs the trailing 1-year σ
  - `years=max` analyses since listing
- `GET /api/news?symbol=LT.NS&name=Larsen%20%26%20Toubro&start=2024-01-02&end=2024-01-02&sector=Industrials`

## Structure

```
app/
  main.py      FastAPI routes + static hosting
  market.py    Yahoo search, ticker resolution (NSE/BSE/SME), history, caching
  analysis.py  period returns, % / σ thresholds, pre-week forensics, summaries
  news.py      Google News (date-windowed) fetch + trigger classification + sector playbooks
  demo.py      synthetic data for MACRO_DEMO=1
static/        liquid-glass single-page UI (vanilla JS + TradingView lightweight-charts, vendored)
tests/
```

## Caveats

- Yahoo Finance is unofficial and rate-limited. Responses are cached in memory for 1 hour (prices) and 24 hours (news).
- Yahoo coverage of SME stocks and very old history can be patchy. Some SME counters only exist on one exchange.
- Google News coverage before ~2010 and for small companies is thin. The trigger classification uses keyword rules, so treat it as a lead to read the headlines, not a verdict.
- Not investment advice.
