"""How much FX risk an exporter carries between the trade and the settlement, and how much leaves when settlement gets shorter.

This is the economic argument for fast settlement rails: the exchange rate keeps moving while the money is in transit.
Method: log returns of a daily exchange-rate series over h business days, on NON-overlapping windows; standard deviation,
5th percentile and 5% CVaR of the exporter's loss (local currency appreciating); reductions between any two horizons, next to the
square-root-of-time benchmark. A band test (Kupiec and Christoffersen) checks whether a percentile band estimated on past data
holds out of sample.

Public data only. The reference series in the examples is the Brazilian PTAX (Banco Central do Brasil, open data).
Descriptive: it measures the past; it does not forecast and it is not investment advice.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from . import stats

DEFAULT_HORIZONS = (2, 5, 10, 20, 30, 60, 90)


@dataclass
class HorizonRisk:
    horizon: int
    n_windows: int
    std: float
    p5: float
    cvar5: float
    cvar5_range: tuple = (float("nan"), float("nan"))


def horizon_returns(log_fx: np.ndarray, h: int, offset: int = 0, overlapping: bool = False) -> np.ndarray:
    """h-day log returns starting at `offset`; step h (non-overlapping) or step 1 (overlapping).
    Negative = the exporter's currency gained (the exporter loses)."""
    x = np.asarray(log_fx, float)[offset:]
    if overlapping:
        return x[h:] - x[:-h]
    ends = x[h::h]
    starts = x[:-h:h][: ends.size]
    return ends - starts


def risk_by_horizon(rates: np.ndarray, horizons=DEFAULT_HORIZONS) -> list[HorizonRisk]:
    """Descriptive risk by horizon on non-overlapping windows, AVERAGED over all h possible start days (the value with a single start
    day depends on that day: on the PTAX the 60-day CVaR moves by several points). `cvar5_range` gives the min and max over start days."""
    lx = np.log(np.asarray(rates, float))
    out = []
    for h in horizons:
        per = []
        for off in range(h):
            r = horizon_returns(lx, h, off)
            if r.size < 30:
                raise ValueError(f"horizon {h}: only {r.size} windows (need 30)")
            per.append((r.std(ddof=1), np.percentile(r, 5), stats.cvar_lower(r, 0.05), r.size))
        a = np.array(per)
        hr = HorizonRisk(h, int(a[:, 3].min()), float(a[:, 0].mean()), float(a[:, 1].mean()), float(a[:, 2].mean()))
        hr.cvar5_range = (float(a[:, 2].min()), float(a[:, 2].max()))
        out.append(hr)
    return out


def reduction(from_h: HorizonRisk, to_h: HorizonRisk) -> dict:
    """Risk that leaves when settlement goes from `from_h` to `to_h` business days."""
    return {"from": from_h.horizon, "to": to_h.horizon,
            "std_reduction": 1 - to_h.std / from_h.std,
            "cvar5_reduction": 1 - abs(to_h.cvar5) / abs(from_h.cvar5),
            "sqrt_time_benchmark": 1 - math.sqrt(to_h.horizon / from_h.horizon)}


MIN_TRAIN_POINTS = 250


def _norm_ppf(p: float) -> float:
    """Inverse standard normal CDF by bisection (no scipy needed)."""
    lo, hi = -10.0, 10.0
    for _ in range(100):
        mid = (lo + hi) / 2
        if stats.norm_cdf(mid) < p:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def band_backtest(rates: np.ndarray, h: int, train: int = 756, lower_q: float = 5, upper_q: float = 95, alpha: float = 0.05,
                  method: str = "sqrt_time") -> dict:
    """Out-of-sample test of the [lower_q, upper_q] band of h-day returns, estimated on the previous `train` days.

    method="sqrt_time" (default): normal band with the 1-day volatility of the `train` days scaled by sqrt(h) (textbook; assumes the
    rate is close to a random walk). It uses every training day, so it holds at long horizons.
    method="overlapping": empirical percentiles of overlapping h-day returns. Kept for comparison: at long horizons the training sample
    holds only about train/h independent points, the band comes out too narrow and fails even on a true random walk.
    (A first version used non-overlapping returns: 8 points at 90 days. Revision of 17/11/2026, with the synthetic test.)
    The test windows themselves do not overlap. `alpha` is per test; with several horizons, pass a corrected alpha."""
    if method not in ("sqrt_time", "overlapping"):
        raise ValueError("method must be 'sqrt_time' or 'overlapping'")
    lx = np.log(np.asarray(rates, float))
    if train - h < MIN_TRAIN_POINTS:
        raise ValueError(f"horizon {h}: {train - h} training points (need {MIN_TRAIN_POINTS}); raise `train`")
    z_lo, z_hi = _norm_ppf(lower_q / 100), _norm_ppf(upper_q / 100)
    hits = []
    t = train
    while t + h < lx.size:
        if method == "sqrt_time":
            d1 = np.diff(lx[t - train:t + 1])
            mu, sd = d1.mean() * h, d1.std(ddof=1) * math.sqrt(h)
            lo, hi = mu + z_lo * sd, mu + z_hi * sd
        else:
            past = horizon_returns(lx[t - train:t + 1], h, overlapping=True)
            lo, hi = np.percentile(past, [lower_q, upper_q])
        r = lx[t + h] - lx[t]
        hits.append(int(r < lo or r > hi))
        t += h
    p_exp = (lower_q + 100 - upper_q) / 100
    n, k = len(hits), int(sum(hits))
    if n < 30:
        raise ValueError(f"horizon {h}: only {n} test windows (need 30)")
    _, pk = stats.kupiec(k, n, p_exp)
    _, pi = stats.christoffersen_independence(hits)
    return {"horizon": h, "method": method, "n": n, "exceptions": k, "expected_rate": p_exp, "observed_rate": k / n, "alpha": alpha,
            "kupiec_p": pk, "independence_p": pi, "passes": bool(pk >= alpha and pi >= alpha)}
