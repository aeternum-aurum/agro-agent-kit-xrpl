"""Minimum-variance hedge ratio with an honest out-of-sample evaluation.

Method (textbook): Johnson, L. L. (1960), "The theory of hedging and speculation in commodity futures", Review of Economic Studies 27(3), 139-151;
Ederington, L. H. (1979), "The hedging performance of the new futures markets", Journal of Finance 34(1), 157-170.
h* = Cov(dS_H, dF_H) / Var(dF_H), where dS_H and dF_H are changes over the SAME horizon H used for the hedge. The ratio changes with the
horizon when the spot market reacts to the hedge instrument with a lag, so a ratio estimated on 1-period changes must not be applied to
H-period changes (revision of 17/11/2026, with the synthetic test that proves it). The ratio is estimated only with data available before
each test window, and the hedging effectiveness 1 - Var(hedged) / Var(unhedged) is measured on windows the estimate never saw, with a
stationary-bootstrap interval.

Nothing here is calibrated: the user brings the series (spot and hedge instrument, same unit) and gets the ratio, the out-of-sample
effectiveness, the CVaR change and the comparison against the naive 1:1 hedge.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from . import stats

MIN_TRAIN_WINDOWS = 20


def ols_ratio(ds: np.ndarray, df: np.ndarray) -> float:
    ds = np.asarray(ds, float); df = np.asarray(df, float)
    v = float(np.var(df, ddof=1))
    if v == 0:
        raise ValueError("hedge instrument has zero variance in the estimation window")
    return float(np.cov(ds, df, ddof=1)[0, 1] / v)


def horizon_sums(x: np.ndarray, horizon: int, overlapping: bool) -> np.ndarray:
    """Sums of `horizon` consecutive changes, ending at the last element; step 1 if overlapping, else `horizon`."""
    x = np.asarray(x, float)
    c = np.concatenate([[0.0], np.cumsum(x)])
    ends = np.arange(x.size, horizon - 1, -1 if overlapping else -horizon)
    return (c[ends] - c[ends - horizon])[::-1]


def ratio_for_horizon(ds: np.ndarray, df: np.ndarray, horizon: int, min_windows: int = MIN_TRAIN_WINDOWS) -> tuple[float, str]:
    """Minimum-variance ratio estimated on `horizon`-period sums inside the training sample.

    Non-overlapping sums when there are at least `min_windows` of them; otherwise overlapping sums (more points, correlated), and the
    returned note says so. Raises if even the overlapping sums are too few."""
    if horizon == 1:
        return ols_ratio(ds, df), "1-period changes"
    s, f = horizon_sums(ds, horizon, False), horizon_sums(df, horizon, False)
    if s.size >= min_windows:
        return ols_ratio(s, f), f"{s.size} non-overlapping {horizon}-period sums"
    s, f = horizon_sums(ds, horizon, True), horizon_sums(df, horizon, True)
    if s.size < min_windows:
        raise ValueError(f"training sample too short for horizon {horizon}: {s.size} overlapping sums (need {min_windows})")
    return ols_ratio(s, f), f"{s.size} OVERLAPPING {horizon}-period sums (too few non-overlapping ones; points are correlated)"


@dataclass
class HedgeReport:
    horizon: int
    n_windows: int
    ratio_last: float
    effectiveness: float
    effectiveness_ci: tuple[float, float]
    effectiveness_one_to_one: float
    cvar_reduction: float
    dm_vs_one_to_one_p: float
    alpha: float = 0.05
    notes: list[str] = field(default_factory=list)

    @property
    def useful(self) -> bool:
        """Useful = lower bound of the effectiveness interval above zero and CVaR not worse (the open protocol's rule, before costs)."""
        return self.effectiveness_ci[0] > 0 and self.cvar_reduction >= 0

    @property
    def beats_one_to_one(self) -> bool:
        """The estimated ratio has a lower squared hedging error than the naive 1:1 hedge (one-sided Diebold-Mariano, p < alpha)."""
        return self.dm_vs_one_to_one_p < self.alpha


def evaluate(ds: np.ndarray, df: np.ndarray, horizon: int = 1, train: int = 52, window: str = "rolling",
             n_boot: int = 2000, mean_block: float = 4.0, seed: int = 0, alpha: float = 0.05) -> HedgeReport:
    """Out-of-sample evaluation on non-overlapping test windows of `horizon` periods.

    ds, df: per-period changes of the spot and of the hedge instrument (same unit, aligned).
    train: periods used to estimate each ratio; `window` is "rolling" (last `train` periods) or "expanding".
    The ratio is estimated on `horizon`-period sums inside the training sample (see ratio_for_horizon).
    """
    ds = np.asarray(ds, float); df = np.asarray(df, float)
    if ds.shape != df.shape:
        raise ValueError("ds and df must be aligned")
    if window not in ("rolling", "expanding"):
        raise ValueError("window must be 'rolling' or 'expanding'")
    rows, how = [], set()
    t = train
    h = float("nan")
    while t + horizon <= ds.size:
        a = 0 if window == "expanding" else t - train
        h, note = ratio_for_horizon(ds[a:t], df[a:t], horizon)
        how.add(note.split(" ", 1)[1] if note[0].isdigit() else note)
        s, f = float(ds[t:t + horizon].sum()), float(df[t:t + horizon].sum())
        rows.append((s, s - h * f, s - f))
        t += horizon
    if len(rows) < 20:
        raise ValueError(f"only {len(rows)} out-of-sample windows; the protocol asks for at least 20")
    r = np.array(rows)

    def eff(x: np.ndarray, col: int = 1) -> float:
        return 1.0 - float(np.var(x[:, col], ddof=1)) / float(np.var(x[:, 0], ddof=1))

    e, lo, hi = stats.bootstrap_ci(eff, r, n_boot=n_boot, mean_block=mean_block, seed=seed, alpha=alpha)
    c0, c1 = stats.cvar_lower(r[:, 0]), stats.cvar_lower(r[:, 1])
    loss_naive = (r[:, 2] - r[:, 2].mean()) ** 2; loss_h = (r[:, 1] - r[:, 1].mean()) ** 2
    _, p = stats.diebold_mariano(loss_naive, loss_h, horizon=1)   # test windows do not overlap, so horizon=1 in the DM sense
    notes = ["before costs; add costs with aeternum_quant.costs", "ratio estimated on: " + "; ".join(sorted(how))]
    return HedgeReport(horizon, len(rows), h, e, (lo, hi), eff(r, 2), 1.0 - c1 / c0 if c0 < 0 else 0.0, p, alpha, notes)
