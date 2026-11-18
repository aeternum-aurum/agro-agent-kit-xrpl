"""Synthetic tests: each method must recover what was planted. Run: python -m tests.test_modulo3 (from the module3 folder)."""
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from aeternum_quant import costs, hedge, settlement_fx, stats  # noqa: E402


def test_kupiec_calibrated_and_not():
    _, p_ok = stats.kupiec(10, 100, 0.10)
    _, p_bad = stats.kupiec(30, 100, 0.10)
    assert p_ok > 0.9 and p_bad < 0.001


def test_christoffersen_clustered():
    iid = np.random.default_rng(1).random(2000) < 0.1
    clustered = np.repeat(np.random.default_rng(2).random(200) < 0.1, 10)
    assert stats.christoffersen_independence(iid.astype(int))[1] > 0.01
    assert stats.christoffersen_independence(clustered.astype(int))[1] < 0.001


def test_bootstrap_covers_mean():
    x = np.random.default_rng(3).normal(1.0, 1.0, 400)
    m, lo, hi = stats.bootstrap_ci(lambda d: float(np.mean(d)), x, n_boot=500, seed=4)
    assert lo < 1.0 < hi and abs(m - 1.0) < 0.2


def test_dm_detects_better_model():
    rng = np.random.default_rng(5)
    e = rng.normal(0, 1, 500)
    _, p = stats.diebold_mariano(e ** 2 * 1.5, e ** 2)
    assert p < 0.01


def test_hedge_recovers_planted_ratio():
    rng = np.random.default_rng(6)
    df = rng.normal(0, 1, 600)
    ds = 0.7 * df + rng.normal(0, 0.4, 600)
    rep = hedge.evaluate(ds, df, horizon=1, train=104, n_boot=300)
    assert abs(rep.ratio_last - 0.7) < 0.15 and rep.useful and rep.effectiveness > 0.6


def test_hedge_useless_when_unrelated():
    rng = np.random.default_rng(7)
    rep = hedge.evaluate(rng.normal(0, 1, 400), rng.normal(0, 1, 400), train=104, n_boot=300)
    assert not rep.useful


def test_fx_sqrt_time_on_random_walk():
    rng = np.random.default_rng(8)
    rates = np.exp(np.cumsum(rng.normal(0, 0.006, 8000))) * 5
    risk = settlement_fx.risk_by_horizon(rates, (2, 8, 32))
    red = settlement_fx.reduction(risk[2], risk[0])
    assert abs(red["std_reduction"] - red["sqrt_time_benchmark"]) < 0.06


def test_fx_band_backtest_runs():
    rng = np.random.default_rng(9)
    rates = np.exp(np.cumsum(rng.normal(0, 0.006, 4000))) * 5
    b = settlement_fx.band_backtest(rates, h=10, train=756)
    assert b["n"] > 100 and 0.0 <= b["observed_rate"] <= 0.3


def test_band_holds_on_random_walk_at_all_horizons():
    """Revision of 17/11 (fix 1): on a true random walk the 5-95 band must hold at every horizon, including 60 and 90 days."""
    rng = np.random.default_rng(10)
    rates = np.exp(np.cumsum(rng.normal(0, 0.006, 40000))) * 5
    horizons = (2, 10, 30, 60, 90)
    for h in horizons:
        b = settlement_fx.band_backtest(rates, h=h, train=756, alpha=0.05 / len(horizons))
        assert 0.06 <= b["observed_rate"] <= 0.14, (h, b["observed_rate"])
        assert b["passes"], (h, b)


def test_band_refuses_short_training():
    rates = np.exp(np.cumsum(np.random.default_rng(11).normal(0, 0.006, 3000)))
    try:
        settlement_fx.band_backtest(rates, h=90, train=300)
    except ValueError:
        return
    raise AssertionError("a 210-point training sample must be refused")


def test_hedge_ratio_uses_the_hedge_horizon():
    """Revision of 17/11 (fix 2): spot = 0.3 f_t + 0.5 f_(t-1) + noise. The 1-period ratio is about 0.3; over 13 periods it is about 0.76.
    The kit must estimate the 13-period ratio and must not lose to the naive 1:1 hedge."""
    rng = np.random.default_rng(12)
    n = 3000
    f = rng.normal(0, 1, n + 1)
    df = f[1:]
    ds = 0.3 * f[1:] + 0.5 * f[:-1] + rng.normal(0, 0.3, n)
    r1 = hedge.evaluate(ds, df, horizon=1, train=260, n_boot=200)
    r13 = hedge.evaluate(ds, df, horizon=13, train=520, n_boot=200)
    assert abs(r1.ratio_last - 0.3) < 0.1, r1.ratio_last
    assert 0.6 < r13.ratio_last < 0.9, r13.ratio_last
    assert r13.effectiveness >= r13.effectiveness_one_to_one - 0.05, (r13.effectiveness, r13.effectiveness_one_to_one)


def test_descriptive_averages_start_days():
    rng = np.random.default_rng(13)
    rates = np.exp(np.cumsum(rng.normal(0, 0.006, 8000))) * 5
    r = settlement_fx.risk_by_horizon(rates, (60,))[0]
    assert r.cvar5_range[0] <= r.cvar5 <= r.cvar5_range[1]


def test_costs_arithmetic():
    c = costs.HedgeCostInputs(fee_per_contract_side=4.0, brokerage_per_contract_side=5.0, contract_size=100, price=1000.0,
                              margin_fraction=0.1, opportunity_rate_year=0.1, roll_every_periods=0)
    r = costs.hedge_cost_per_unit_per_period(c)
    assert math.isclose(r["turnover"], 0.18) and math.isclose(r["margin_carry"], 1000 * 0.1 * 0.1 / 52)
    assert math.isclose(costs.cost_of_money_in_transit(1_000_000, 0.10, 63), 25_000.0)


if __name__ == "__main__":
    fns = [v for k, v in dict(globals()).items() if k.startswith("test_")]
    for f in fns:
        f()
    print(f"{len(fns)} tests ok")
