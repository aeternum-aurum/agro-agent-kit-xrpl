"""Statistical backbone for the open agent kit (module 3).

Textbook methods only, written from the original papers:
- stationary bootstrap: Politis, D. N. and Romano, J. P. (1994), "The Stationary Bootstrap", JASA 89(428), 1303-1313;
- unconditional coverage test: Kupiec, P. (1995), "Techniques for verifying the accuracy of risk measurement models", Journal of Derivatives 3(2), 73-84;
- independence test: Christoffersen, P. (1998), "Evaluating interval forecasts", International Economic Review 39(4), 841-862;
- forecast comparison: Diebold, F. X. and Mariano, R. S. (1995), "Comparing predictive accuracy", JBES 13(3), 253-263, with the
  Newey-West (1987) long-run variance.
Only numpy and the standard library. No data and no calibrated coefficient ship with this file.
"""
from __future__ import annotations

import math
from typing import Callable, Sequence

import numpy as np


def _chi2_sf_1(x: float) -> float:
    """Survival function of a chi-square with 1 degree of freedom."""
    return math.erfc(math.sqrt(max(x, 0.0) / 2.0))


def norm_cdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def stationary_bootstrap_indices(n: int, mean_block: float, rng: np.random.Generator) -> np.ndarray:
    """One resample of indices 0..n-1 with geometric block lengths of mean `mean_block` (Politis and Romano, 1994)."""
    if n <= 0:
        raise ValueError("n must be positive")
    p = 1.0 / mean_block
    idx = np.empty(n, dtype=int)
    idx[0] = rng.integers(n)
    for t in range(1, n):
        idx[t] = rng.integers(n) if rng.random() < p else (idx[t - 1] + 1) % n
    return idx


def bootstrap_ci(statistic: Callable[[np.ndarray], float], data: np.ndarray, n_boot: int = 2000, mean_block: float = 4.0,
                 alpha: float = 0.05, seed: int = 0) -> tuple[float, float, float]:
    """Point estimate and percentile interval of `statistic` under the stationary bootstrap. `data` rows are resampled together."""
    data = np.asarray(data)
    rng = np.random.default_rng(seed)
    point = float(statistic(data))
    draws = np.array([statistic(data[stationary_bootstrap_indices(len(data), mean_block, rng)]) for _ in range(n_boot)])
    lo, hi = np.quantile(draws, [alpha / 2, 1 - alpha / 2])
    return point, float(lo), float(hi)


def kupiec(n_exceptions: int, n: int, p_expected: float) -> tuple[float, float]:
    """Kupiec (1995) proportion-of-failures likelihood ratio and its p-value (chi-square, 1 df)."""
    if not 0 < p_expected < 1 or n <= 0:
        raise ValueError("need 0 < p_expected < 1 and n > 0")
    x = n_exceptions
    phat = x / n
    ll0 = (n - x) * math.log(1 - p_expected) + x * math.log(p_expected)
    ll1 = (0.0 if x == n else (n - x) * math.log(1 - phat)) + (0.0 if x == 0 else x * math.log(phat))
    lr = -2.0 * (ll0 - ll1)
    return lr, _chi2_sf_1(lr)


def christoffersen_independence(hits: Sequence[int]) -> tuple[float, float]:
    """Christoffersen (1998) first-order Markov independence test of the exception sequence. Returns (LR, p-value)."""
    h = np.asarray(hits, dtype=int)
    if h.size < 2:
        raise ValueError("need at least two observations")
    a, b = h[:-1], h[1:]
    n00 = int(np.sum((a == 0) & (b == 0))); n01 = int(np.sum((a == 0) & (b == 1)))
    n10 = int(np.sum((a == 1) & (b == 0))); n11 = int(np.sum((a == 1) & (b == 1)))

    def ll(k0: int, k1: int, p: float) -> float:
        return (k0 * math.log(1 - p) if k0 else 0.0) + (k1 * math.log(p) if k1 else 0.0)

    pi = (n01 + n11) / max(n00 + n01 + n10 + n11, 1)
    pi0 = n01 / max(n00 + n01, 1); pi1 = n11 / max(n10 + n11, 1)
    if pi in (0.0, 1.0):
        return 0.0, 1.0
    l_null = ll(n00 + n10, n01 + n11, pi)
    l_alt = (ll(n00, n01, pi0) if 0 < pi0 < 1 else 0.0) + (ll(n10, n11, pi1) if 0 < pi1 < 1 else 0.0)
    lr = max(-2.0 * (l_null - l_alt), 0.0)
    return lr, _chi2_sf_1(lr)


def newey_west_variance(x: np.ndarray, lags: int | None = None) -> float:
    """Long-run variance of the mean of x with Bartlett weights (Newey and West, 1987)."""
    x = np.asarray(x, float) - np.mean(x)
    n = x.size
    if lags is None:
        lags = int(math.floor(4 * (n / 100.0) ** (2.0 / 9.0)))
    v = float(x @ x) / n
    for k in range(1, lags + 1):
        v += 2 * (1 - k / (lags + 1)) * float(x[k:] @ x[:-k]) / n
    return v


def diebold_mariano(loss_a: np.ndarray, loss_b: np.ndarray, horizon: int = 1) -> tuple[float, float]:
    """One-sided Diebold-Mariano test of H1: model B has lower expected loss than model A. Returns (statistic, p-value).

    Lags of the long-run variance: h - 1 when horizon > 1 (as in the paper); for horizon 1 the automatic Newey-West rule
    floor(4 (n/100)^(2/9)), which guards against leftover autocorrelation. With few windows the test is approximate; a small-sample
    correction exists (Harvey, Leybourne and Newbold, 1997) and is not applied here."""
    d = np.asarray(loss_a, float) - np.asarray(loss_b, float)
    var = newey_west_variance(d, lags=max(horizon - 1, 0) if horizon > 1 else None)
    if var <= 0:
        return 0.0, 0.5
    stat = float(np.mean(d)) / math.sqrt(var / d.size)
    return stat, 1.0 - norm_cdf(stat)


def cvar_lower(x: np.ndarray, q: float = 0.05) -> float:
    """Expected value of the worst q fraction of outcomes (lower tail)."""
    s = np.sort(np.asarray(x, float))
    k = max(1, int(math.ceil(q * s.size)))
    return float(s[:k].mean())
