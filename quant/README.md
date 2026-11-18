# AETERNUM Agro Agent Kit: module 3, the quantitative library

**Purpose:** the numbers an agent needs before it pays, hedges or settles a commodity trade, each one checked out of sample. Part of the open kit for the XRPL (modules 1, 2 and 4 are the oracle, the mandate and paid access).

**Rules of this module:**
- Public data and textbook methods only.
- No calibrated coefficient, no proprietary series, no exchange data.
- Not investment advice.

## What is inside

| File | What it does | Method and papers |
|---|---|---|
| `aeternum_quant/hedge.py` | Minimum-variance hedge ratio, its out-of-sample effectiveness with a bootstrap interval, the CVaR change and the comparison with the 1:1 hedge | Johnson (1960); Ederington (1979); Politis and Romano (1994); Diebold and Mariano (1995) |
| `aeternum_quant/settlement_fx.py` | FX risk carried between trade and settlement, by horizon (2 to 90 business days); how much leaves when settlement gets shorter; a band backtest | Kupiec (1995); Christoffersen (1998) |
| `aeternum_quant/costs.py` | Hedge carrying cost (fees, brokerage, margin carry); cost of money in transit; freight per tonne | arithmetic, user-supplied inputs |
| `aeternum_quant/stats.py` | Stationary bootstrap, Kupiec, Christoffersen, Diebold-Mariano with Newey-West, CVaR | as cited in the file |
| `aeternum_quant/public_data.py` | Loader for the Banco Central do Brasil open SGS API, plus a generic CSV reader | — |
| `protocol/PREREGISTRATION_TEMPLATE.md` | The test protocol: pre-registration, out of sample, negative results published | — |
| `tests/test_modulo3.py` | 13 synthetic tests: each method recovers what was planted, the band holds on a random walk at 2 to 90 days, the hedge uses the hedge horizon | — |

## Why it matters for fast settlement
`settlement_fx` puts a number on what a fast rail gives a commodity exporter. With the public PTAX (Banco Central do Brasil), the FX loss in the worst 5% of cases between trade and payment falls when settlement goes from 60 to 2 business days by:
- **78%** from 1994 to 2026;
- **75%** from 2015 to 2026.

Both are averages over all start days. The square-root-of-time benchmark is 82%. That is roughly three quarters to four fifths.
- **Start day:** the 60-day CVaR alone moves by several points with the start day, so the module reports the average and the range.
- **Nature of the figure:** it is descriptive. It measures the past and does not forecast.

**Band test on the real series:**
- With the square-root-of-time band, the PTAX leaves the 5-95 band about as often as it should (10% to 11% at 2 to 10 days).
- It still fails the independence test at short horizons, because exchange-rate volatility comes in regimes.
- That is a property of the market, not of the test: on a true random walk the band holds at every horizon, which the tests check.

## Rules the code enforces
- **Hedge ratio:** estimated on changes over the **same horizon** as the hedge. A 1-period ratio applied to 13 periods loses to the naive 1:1 hedge when the spot market reacts with a lag (test `test_hedge_ratio_uses_the_hedge_horizon`).
- **Band estimation:** uses every training day (square-root-of-time scaling) and needs at least 250 training points.
- **Multiple horizons:** `alpha` is a parameter, so pass a corrected one when testing several horizons.
- **`HedgeReport` fields:**
  - `useful`: the effectiveness interval is above zero and the CVaR is not worse, before costs;
  - `beats_one_to_one`: one-sided Diebold-Mariano against the 1:1 hedge;
  - costs: computed with `costs.hedge_cost_per_unit_per_period` before any money decision.

## Run the tests
```
cd modulo3
python -m tests.test_modulo3
```
Requirements: Python 3.10+ and numpy.

## License
Apache-2.0 (see LICENSE).

---
**Resumo em português:** biblioteca aberta do kit para agentes de commodities na XRPL. Traz:
- a razão de hedge de mínima variância testada fora da amostra;
- o risco cambial pelo prazo de liquidação;
- os custos da operação;
- os testes de cobertura e comparação.

Só usa dado público e método de livro, sem coeficiente da AETERNUM. Não é recomendação.
