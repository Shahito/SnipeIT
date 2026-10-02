# Adding a new technical indicator to SnipeIT

SnipeIT has **two independent implementations of every indicator**:

- `python/indicators.py` - the source of truth, used by the real backtest engine
  (`python/backtest.py`) and by the parity exporter (`python/parity_export.py`).
- `src/utils/indicatorEngine.js` - a hand-written JS port, used **only** to overlay
  indicators on the live trade chart (`src/controllers/candleController.js` ->
  `public/js/trade-chart.js`). It must produce numerically identical output to the
  Python side, on the same candles, for the same parameters.

`test/indicatorParity.test.js` (`npm run test:parity`) is what enforces that: it
runs both implementations against the fixed fixture `test/fixtures/candles.json`
and fails if any value differs by more than `1e-6` (absolute) or `1e-9` (relative).

Beyond the two math implementations, a *usable* indicator also needs to be:
registered for input validation (backend), selectable in the strategy editor
(frontend), translated (i18n), and optionally drawn on the chart. None of this
is handled by a single file - this guide walks through every touchpoint, in the
order you'll naturally hit them, with the exact anchors to edit.

The *only* JS indicator implementation that matters is
`src/utils/indicatorEngine.js` - it's the one used by `candleController.js`
(the route actually mounted in `app.js`), and the one `indicatorParity.test.js`
checks against Python.

## 0. Pick your identifiers

Decide, up front, for the whole feature:

- **Indicator key**: an `UPPER_SNAKE_CASE` id, e.g. `ROC`. This exact string is
  used verbatim in both `REGISTRY` dicts, in strategy `conditions` JSON, and in
  every frontend array below. It must match byte-for-byte everywhere.
- **Column name template**: the name of the computed column, following the
  existing convention - `RSI_14`, `EMA_VOLUME_20`, `MACD_signal_12_26_9`,
  `BB_UPPER_20`, `VWAP` (no period). This is what `column_name()` /
  `columnName()` must produce identically on both sides, since it's the "wire
  format" column name used in JSON responses, condition evaluation, and chart
  labels.
- **Shape**: single-column (`pd.Series` / a plain array) like `RSI`, or
  multi-column (`pd.DataFrame` / several named arrays) like `MACD` or
  `BB_UPPER`/`BB_MID`/`BB_LOWER` (three *separate indicator keys* that share
  one calculation).

The worked example used throughout this guide is **ROC** (Rate of Change,
period-based, single column, no `source` support) - simple enough to show
every mandatory step without the extra complexity of a multi-column or
`source`-aware indicator (those variants are called out separately where they
differ).

## 1. Python - `python/indicators.py` (source of truth)

1. Write `compute_<name>(df: pd.DataFrame, **kwargs) -> pd.Series` (or
   `-> pd.DataFrame` for multi-column). Keep it a pure function of `df` and its
   kwargs - this is what `compute_all()` and `parity_export.py` call directly.

   ```python
   def compute_roc(df: pd.DataFrame, period: int = 10) -> pd.Series:
       prev = df["close"].shift(period)
       return ((df["close"] - prev) / prev.replace(0, np.nan) * 100).rename(f"ROC_{period}")
   ```

2. Register it in `REGISTRY`:

   ```python
   "ROC": {
       "fn":      compute_roc,
       "periods": [9, 10, 12],   # informational only - see note below
       "params":  {"period": 10},
       "col_tpl": "ROC_{period}",
   },
   ```

   - `params` must contain the **default** value for every kwarg your function
     takes besides `df`.
   - `col_tpl` is a `str.format()` template; `column_name()` fills in `period`
     (and, for `extra_params` indicators, the extra kwargs - see MACD below).
   - `periods` is **not read anywhere in the code** (checked across the whole
     repo) - it exists purely as documentation of "sensible values", should you
     later want a dropdown of common periods. Don't rely on it for anything
     functional.

3. **If your indicator takes a `source`** (like `EMA`/`SMA` - "RSI of volume"
   style): add `"col_tpl_src": "{name}_{{source}}_{{period}}".format(...)`
   equivalent (see `EMA`'s `col_tpl_src`) and `"sources": [...]` to the
   registry entry. `SOURCE_SERIES` at the top of the file already maps
   `CLOSE/VOLUME/HIGH/LOW/OPEN` to DataFrame columns - you won't need to touch
   it unless you're adding a genuinely new source type.

4. **If your indicator takes extra params beyond period/source** (like
   `MACD`'s `fast`/`slow`/`signal`): add `"extra_params": {...}` with defaults.
   `column_name()` merges `extra_params` with any per-condition `settings`
   override automatically - no extra code needed there.

5. **If your function returns a DataFrame** (multiple output columns, like
   `compute_macd` or `compute_bollinger`): register **one REGISTRY entry per
   output column** (e.g. `MACD`, `MACD_SIGNAL`, `MACD_HIST` all point at the
   same `compute_macd` function, with different `col_tpl`s), then:
   - add every one of those keys to `MULTI_COL`,
   - add the "secondary" keys to `SHARED_CALC`, pointing at a shared calc-key
     string (see how `MACD_SIGNAL`/`MACD_HIST` both map to `"MACD"`, and
     `BB_UPPER`/`BB_LOWER` to `"BB"`). This is what makes `compute_all()` run
     the expensive calculation once instead of once per sub-column.

6. **You do not need to touch** `column_name()`, `resolve_value()`,
   `extract_needed()`, or `compute_all()` - they're fully generic over
   `REGISTRY`/`MULTI_COL`/`SHARED_CALC`.

## 2. JS port - `src/utils/indicatorEngine.js`

This file is a parallel, independently-written implementation - not a
transpile of the Python one - so every piece below has to be added by hand,
mirroring Python's semantics exactly, not just matching its output on the
test fixture.

1. Mirror the registry entry in `REGISTRY` (used here only for column naming /
   warmup, the math lives separately):

   ```js
   ROC: { params: { period: 10 } },
   ```

   Add `sources: [...]` if it takes a source, matching step 1.3 above.

2. **If it needs non-default warmup** (see §4 below for what "default" means),
   add it to `FIXED_MINIMUMS` the same way `MACD`/`VWAP`/`PRICE`/`VOLUME` are.

3. Add a case to `columnName()`'s `switch`, producing **exactly** the same
   string as Python's `column_name()`:

   ```js
   case "ROC": return `ROC_${p}`
   ```

4. Write the math function. Reuse the existing primitives (`ewm`,
   `rollingMean`, `rollingStd`) wherever the pandas operation matches one of
   them - don't hand-roll a window loop that's "close enough".

   ```js
   function computeROC(close, period) {
     const n = close.length
     const out = new Array(n).fill(NaN)
     for (let i = period; i < n; i++) {
       const prev = close[i - period]
       if (prev === 0 || Number.isNaN(prev) || Number.isNaN(close[i])) continue
       out[i] = (close[i] - prev) / prev * 100
     }
     return out
   }
   ```

   Note on `ewm()`: the JS helper resets its running state to `NaN` whenever
   it hits a `NaN` input, whereas pandas' `.ewm(adjust=False)` keeps
   smoothing through internal `NaN`s using the last valid value. The two
   disagree only when a series has `NaN`s in the middle, not just a leading
   gap. If your input series can have internal gaps, account for this
   difference explicitly rather than assuming the two implementations match.

5. **Wire it into the actual dispatcher - `computeColumns()`.** This is the
   step the automated parity test *cannot* catch (see §5) and is the single
   easiest thing to forget:

   ```js
   case "ROC": columns[col] = computeROC(ohlcv.close, p); break
   ```

   For a multi-column indicator, add a dedicated `if ([...].includes(indicator))`
   block instead (modelled on the existing `MACD` / `BB_*` / `STOCH_RSI_*`
   blocks), with its own `cache` key so the shared calculation only runs once.

6. Export the new function in the `module.exports` block at the bottom - the
   parity test imports functions directly from here.

## 3. Parity test wiring

1. `test/indicatorParity.test.js`: call the new JS function directly and add
   it to `results`:

   ```js
   results['ROC_10'] = toNullArr(engine.computeROC(close_, 10))
   ```

2. `python/parity_export.py`: add a matching case so the Python side computes
   the same column on the same fixture:

   ```python
   CASES = [
       ...,
       ("ROC", {"period": 10}),
   ]
   FN = {
       ...,
       "ROC": ind.compute_roc,
   }
   ```

3. Run it:

   ```bash
   npm run test:parity
   ```

   It should print `✅ JS/Python parity OK - N indicators, ...` with `N`
   incremented by one (or more, for multi-column indicators).

   This script shells out to a plain `python3` on `PATH` (see
   `execFileSync('python3', ...)` in `test/indicatorParity.test.js`) - it does
   not activate any virtual environment itself. Run it with the project's
   Python environment active (the one `python/requirements.txt` was installed
   into), so `pandas`/`numpy` are present and at the versions the rest of the
   project uses. A different `python3` on `PATH` - missing dependencies, or a
   different `pandas`/`numpy` version - can make the test fail to run at all,
   or pass/fail based on behavior that differs from the environment the
   backtest worker actually runs in.

### What this test does *not* catch

`indicatorParity.test.js` calls `engine.computeRSI`, `engine.computeROC`, etc.
**directly** - it never goes through `computeColumns()`. That means forgetting
step 2.5 above (the `computeColumns()` dispatch case) leaves the math correct,
the parity test green, and the indicator **silently absent from every real
`/candles` API response** - nothing in the automated suite will tell you.

Verify the actual pipeline separately, e.g. with a short throwaway script:

```js
const engine = require('./src/utils/indicatorEngine')
const ohlcv = { /* time/open/high/low/close/volume arrays */ }
const needed = [{ indicator: 'ROC', period: 12, source: null, timeframe: null, settings: null }]
console.log(Object.keys(engine.computeColumns(needed, ohlcv)))   // must include 'ROC_12'
```

and the Python equivalent:

```python
from indicators import compute_all, column_name
out = compute_all(df, [("ROC", 12, None, None, None)])
assert column_name("ROC", 12) in out.columns
```

Both must return the exact same column name (`ROC_12`) and the same values.
This is a mandatory manual step: it checks the wiring that the parity test
does not exercise.

## 4. Warm-up sizing (both sides, independently)

Indicators need "warm-up" candles fetched *before* the requested start date so
they've converged by the time real data begins. This is computed twice,
independently, and both need to be correct:

- **`src/utils/indicatorEngine.js`**: `warmupCandles()` / `FIXED_MINIMUMS` -
  feeds the live chart's warm-up window. Default is `max(period) * 2 + 1`;
  override via `FIXED_MINIMUMS` only for fixed-column indicators like MACD.

- **`python/backtest.py`**: `_warmup_candles()` - feeds the actual backtest
  engine's warm-up window, and uses a *more careful* model than the JS side:
  - plain rolling-window indicators (SMA, Bollinger, VWAP, raw
    CLOSE/VOLUME/HIGH/LOW/OPEN) -> `2 * period`,
  - standard EMA -> `4 * period` (`_EMA_FACTOR`),
  - MACD -> `4 * (slow + signal)` (two EMA convergences stack),
  - **Wilder-smoothed indicators** (EWM with `alpha = 1/period`, which
    converges much slower than a standard EMA) -> `8 * period`
    (`_WILDER_FACTOR`). `RSI`, `ATR`, `STOCH_RSI_K`, `STOCH_RSI_D` are listed
    in `_WILDER_INDICATORS` for this reason.

If your new indicator uses `.ewm(alpha=1/period, adjust=False)` (Wilder-style
smoothing) rather than `.ewm(span=period)` (standard EMA), **add its key to
`_WILDER_INDICATORS`** - otherwise the backtest will under-warm it and produce
measurably wrong values on the first simulated candles. If it's a plain
rolling-window indicator (like ROC above), it falls into the default branch
and needs no change.

## 5. Higher-timeframe (HTF) support - nothing to do

`extract_needed()` / `extractNeeded()`, `column_name()`-based alignment
(`_merge_htf_column()` in Python, `mergeHtfColumn()` in JS), and the
`@timeframe` column-suffix convention are all generic over `REGISTRY`. As long
as steps 1–3 are done correctly, your indicator automatically works when a
strategy condition references it on a higher timeframe than the strategy's
base one - no indicator-specific HTF code to write.

## 6. Backend input validation - `src/services/strategyService.js`

**This is not documented anywhere else in the codebase and is easy to forget**,
because nothing fails loudly in development - the indicator works fine in the
UI, in the chart, and even in a manually-crafted API payload tested against the
Python backtest directly. It only breaks when a *real* strategy save goes
through the normal `/api/strategies` endpoint:

`validateConditions()` hardcodes a `validIndicators` array. If your new key
isn't in it, **every create/update of a strategy using it is rejected** with
`CONDITIONS_INVALID`.

```js
const validIndicators = [
  'RSI', 'EMA', 'SMA', 'MACD', 'MACD_SIGNAL', 'MACD_HIST',
  'STOCH_RSI_K', 'STOCH_RSI_D', 'BB_UPPER', 'BB_LOWER', 'BB_MID',
  'ATR', 'ROC', 'VWAP', 'CLOSE', 'VOLUME', 'HIGH', 'LOW', 'OPEN',   // + ROC
]
```

If it takes a `source`, also add its key to `indicatorsWithSources` in the
same function.

`rule.settings` (the dict carrying extra params like MACD's
fast/slow/signal) is not validated server-side: bounds only exist
client-side, via `INDICATOR_EXTRA_PARAMS`' `min`/`max`. If your indicator
adds `extra_params`, its value range is enforced only by the frontend.

## 7. Frontend - making it selectable in the strategy editor

All of `condition-renderer.js`, `condition-settings.js`, `strategy-form.js` and
`sweep-labels.js` are **data-driven** off the constants in
`public/js/indicator-config.js` - you only need to touch the config, never
their logic.

**`public/js/indicator-config.js`:**

1. `INDICATORS` - add the string id.
2. `INDICATORS_WITH_PERIOD` - if it takes a period.
3. `INDICATOR_DEFAULT_PERIOD` - must match Python's `REGISTRY[...]["params"]["period"]` exactly (step 1.2).
4. `INDICATORS_WITH_SOURCES` - if it supports a `source`.
5. `INDICATOR_EXTRA_PARAMS` - if it has extra params beyond period/source. The
   object's `key`s must match Python's `extra_params` dict keys exactly - they
   travel as-is inside the condition's `settings` field.
6. `INDICATORS_NO_COMBINE` - only if "combine with another indicator" should
   be disallowed for it (this is used for oscillator-only indicators like
   `RSI`, `STOCH_RSI_K`/`_D`, where combining with a price-scale indicator
   wouldn't make sense).

```js
const INDICATORS = [..., 'ATR', 'ROC', 'VWAP', ...]
const INDICATOR_DEFAULT_PERIOD = { ..., ATR: 14, ROC: 10 }
```

**`public/js/indicator-picker.js`:**

7. Add an entry to the right category in `window.INDICATOR_CATEGORIES`
   (`momentum` / `trend` / `volatility` / `price_volume`), or create a new
   category object if none fits:

   ```js
   { value: 'ROC', labelKey: 'picker.ind.roc' },
   ```

## 8. i18n - `public/locales/en.json` and `public/locales/fr.json`

Add `"picker.ind.<name>": "<Display name>"` to **both** files, at the **same
position** (key order, not just key set, is enforced):

```json
"picker.ind.stoch_rsi_d": "Stochastic RSI %D",
"picker.ind.roc": "Rate of Change",
```

If you added extra params (`INDICATOR_EXTRA_PARAMS`), their `labelKey`s need
matching entries too (reuse the `settings.macd.*` group's pattern if it fits,
or add a new one).

Then run:

```bash
npm run test:i18n   # = test:i18n-sync + test:i18n-keys
```

- `test:i18n-sync` fails if a key exists in one locale file but not the other,
  or if the two files' key order diverges.
- `test:i18n-keys` fails if code references a key that's declared in neither
  locale file (a `labelKey: '...'` in a JS config object counts as "used", so
  the picker entry from step 7 is itself enough to make this test require the
  translation - you don't need both to exist "just in case", but if you add
  the config entry without the translation, this test will fail).

## 9. Chart display - `public/js/trade-chart.js` (optional, but usually wanted)

Being added to `INDICATORS` makes the indicator usable inside strategy
conditions and the backtest engine. **It does not make it appear on the trade
chart** - that's a separate, optional step, driven by column-name prefix
matching (not a registry):

1. `kindOf(label)` - classify your column-name prefix into a pane:
   - `'overlay'` - price-scale, shares the main candle pane (EMA/SMA on
     price, Bollinger Bands, VWAP, …) - **this is the default** if no branch
     matches, so a plain overlay indicator needs no new branch at all;
   - `'oscillator'` - shares the existing RSI/StochRSI 0–100ish pane;
   - `'macd'` - gets its own pane per MACD family (grouped by
     fast/slow/signal, see `macdFamilyKey`);
   - `'atr'` - dedicated ATR pane;
   - `'volume'` - contract-unit pane (used for EMA/SMA computed on the
     `VOLUME` source, since they're off the price scale);
   - `'skip'` - don't plot at all (used for raw `PRICE`/`VOLUME`/`HIGH`/
     `LOW`/`OPEN`, which would just duplicate the candlesticks).

   ROC, for example, is unit-less (a percentage, not a price) and arguably
   deserves its own pane rather than `'overlay'` - if so, add a branch:

   ```js
   if (label.startsWith('ROC_')) return 'roc'
   ```

   and a matching `paneEntries.push({...kind: 'roc'...})` block (model it on
   the `atr` block - the simplest existing one), plus a `chart.pane.roc` /
   `chart.unit.roc` i18n key (step 8) for its toggle label.

2. `shortLabel(rawLabel)` - add a case for a human-friendly legend name
   (optional: falling back to the raw column name still works, just less
   polished):

   ```js
   if (base.startsWith('ROC_')) return `ROC ${base.slice(4)}` + suffix
   ```

Skipping this whole section only means the indicator works inside strategy
conditions and backtests but is never drawn - a perfectly valid choice for an
indicator that's only meant to be used as a *condition*, not visualized.

## 10. Final checklist

1. `python/indicators.py` - `compute_<name>()` + `REGISTRY` entry (+ `MULTI_COL`/`SHARED_CALC` if multi-column)
2. `src/utils/indicatorEngine.js` - `REGISTRY` entry, `columnName()` case, `compute<Name>()`, **`computeColumns()` dispatch case**, export
3. `test/indicatorParity.test.js` - call the new JS function, add to `results`
4. `python/parity_export.py` - add to `CASES` + `FN`
5. `python/backtest.py` - add to `_WILDER_INDICATORS` if EWM/Wilder-smoothed
6. `src/services/strategyService.js` - add to `validIndicators` (+ `indicatorsWithSources` if applicable)
7. `public/js/indicator-config.js` - `INDICATORS` (+ `*_WITH_PERIOD`/`*_WITH_SOURCES`/`*_DEFAULT_PERIOD`/`EXTRA_PARAMS`/`NO_COMBINE` as applicable)
8. `public/js/indicator-picker.js` - entry in `INDICATOR_CATEGORIES`
9. `public/locales/en.json` + `fr.json` - `picker.ind.<name>` (same position in both)
10. `public/js/trade-chart.js` - `kindOf()` + `shortLabel()` (only if it should be charted)

Verification, in order:

```bash
npm run test:parity   # math parity, both implementations (needs the project's python3 env active)
npm run test:i18n     # locale sync + no undeclared keys
```

...plus the manual pipeline check from §3 (the parity test's blind spot), and
ideally one real end-to-end pass: create a strategy using the new indicator in
a condition through the actual UI, launch a backtest, and open its chart - no
single automated test in this repo covers all ten touchpoints at once.