"""Settlement and freight costs inside the trade, so an agent compares like with like.

Three pieces, all user-supplied (no tariff, freight table or rate ships with the kit):
1. hedge carrying cost per period: exchange fees and brokerage on each round trip, plus the opportunity cost of the margin deposit;
2. cost of money in transit: the trade value earning nothing while settlement is pending;
3. freight per tonne times the shipped tonnes.
`settlement_comparison` puts the FX risk (from settlement_fx) and the cost of money side by side for two settlement horizons.
Descriptive arithmetic; not investment advice.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class HedgeCostInputs:
    fee_per_contract_side: float       # exchange fee per contract and side, in the trade currency
    brokerage_per_contract_side: float
    contract_size: float               # units per contract (for example 100 bags)
    price: float                       # price per unit
    margin_fraction: float             # initial margin as a fraction of the contract value
    opportunity_rate_year: float       # cost of the money locked as margin
    roll_every_periods: int            # 0 = open and close every period
    periods_per_year: int = 52


def hedge_cost_per_unit_per_period(c: HedgeCostInputs, hedge_ratio: float = 1.0) -> dict:
    round_trip = 2 * (c.fee_per_contract_side + c.brokerage_per_contract_side) / c.contract_size
    turnover = round_trip / c.roll_every_periods if c.roll_every_periods > 0 else round_trip
    carry = c.margin_fraction * c.price * c.opportunity_rate_year / c.periods_per_year
    total = abs(hedge_ratio) * (turnover + carry)
    return {"turnover": abs(hedge_ratio) * turnover, "margin_carry": abs(hedge_ratio) * carry, "total": total,
            "margin_share": (carry / (turnover + carry)) if (turnover + carry) > 0 else 0.0}


def cost_of_money_in_transit(trade_value: float, rate_year: float, business_days: int, days_per_year: int = 252) -> float:
    return trade_value * rate_year * business_days / days_per_year


def freight_cost(tonnes: float, cost_per_tonne: float) -> float:
    return tonnes * cost_per_tonne


def settlement_comparison(trade_value: float, rate_year: float, cvar5_long: float, cvar5_short: float,
                          days_long: int, days_short: int) -> dict:
    """Expected cost of money and 5% CVaR of FX loss, in trade-value units, for a long and a short settlement horizon."""
    return {
        "long": {"days": days_long, "money_cost": cost_of_money_in_transit(trade_value, rate_year, days_long), "fx_cvar5": trade_value * abs(cvar5_long)},
        "short": {"days": days_short, "money_cost": cost_of_money_in_transit(trade_value, rate_year, days_short), "fx_cvar5": trade_value * abs(cvar5_short)},
    }
