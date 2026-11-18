"""Loaders for PUBLIC series only. Nothing is downloaded at import time and no data ships with the kit.

- Banco Central do Brasil, SGS open data API (no key): series 1 = US dollar, selling rate (PTAX), daily. Checked on 2026-11-17:
  the values match the official PTAX selling rate to the fourth decimal (2015-01-02 to 2015-01-06 and 2026-10-14 to 2026-10-16).
  URL pattern: https://api.bcb.gov.br/dados/serie/bcdata.sgs.{code}/dados?formato=json&dataInicial=DD/MM/AAAA&dataFinal=DD/MM/AAAA
  Each call accepts at most a 10-year window (checked on 2026-11-17: 10 years returns 200, 13 years returns HTTP 406),
  so fetch_sgs asks in 10-year chunks.
- World Bank, Commodity Price Data, monthly, CC BY 4.0: the user downloads the official monthly workbook and passes the path;
  cite as "Source: World Bank".
"""
from __future__ import annotations

import csv
import datetime as dt
import json
import time
import urllib.error
import urllib.request

USER_AGENT = "aeternum-agro-agent-kit/0.1 (open source)"
SGS_URL = "https://api.bcb.gov.br/dados/serie/bcdata.sgs.{code}/dados?formato=json&dataInicial={start}&dataFinal={end}"


def fetch_sgs(code: int, start: dt.date, end: dt.date, timeout: float = 60.0, retries: int = 3) -> list[tuple[dt.date, float]]:
    """Daily series from the BCB SGS API, in 10-year chunks. Returns [(date, value)] sorted by date."""
    out: list[tuple[dt.date, float]] = []
    a = start
    while a <= end:
        b = min(dt.date(a.year + 9, 12, 31), end)
        url = SGS_URL.format(code=code, start=a.strftime("%d/%m/%Y"), end=b.strftime("%d/%m/%Y"))
        for attempt in range(retries):
            try:
                req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
                with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 (fixed public https host)
                    body = resp.read().decode("utf-8").strip()
                    rows = json.loads(body) if body else []   # an empty answer = no data in the window (holidays, future dates)
                break
            except urllib.error.HTTPError as e:  # the API answers 502/503 now and then; 4xx means a bad request
                if e.code < 500 or attempt == retries - 1:
                    raise
                time.sleep(2 ** attempt)
        for row in rows:
            out.append((dt.datetime.strptime(row["data"], "%d/%m/%Y").date(), float(row["valor"])))
        a = dt.date(b.year + 1, 1, 1)
    return sorted(set(out))


def read_csv_series(path: str, date_col: str = "date", value_col: str = "value", date_fmt: str = "%Y-%m-%d") -> list[tuple[dt.date, float]]:
    """Generic CSV reader for a series the user already downloaded from a public source."""
    with open(path, encoding="utf-8") as fh:
        rows = [(dt.datetime.strptime(r[date_col], date_fmt).date(), float(r[value_col])) for r in csv.DictReader(fh) if r[value_col]]
    return sorted(rows)
