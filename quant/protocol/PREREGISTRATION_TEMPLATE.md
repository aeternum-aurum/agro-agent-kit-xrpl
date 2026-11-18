# Pre-registration template (open test protocol)

Write this file and commit it **together with the script, before running anything**. Run only after the commit (we wait 30 minutes). If you find an error before seeing any result, write an amendment here, commit, and wait again. A negative result is a deliverable: publish it.

## 1. Question
One sentence. What would change in the agent's decision if the answer is yes?

## 2. Source and license
Public series only. Name, URL, license, period, frequency, unit, and the SHA-256 and date of the exact file used (so a third party can rerun it). Cite the source the way its license asks (for example "Source: World Bank", "Fonte: Banco Central do Brasil").

## 3. Method
Name the paper (authors, year, journal, DOI checked on Crossref or OpenAlex) and say what you adapted. Say whether you read the text; what comes only from an indirect citation is marked as a hypothesis. Estimation uses only data available before each test window.

## 4. Out-of-sample design
Training length, rolling or expanding window, horizon, non-overlapping test windows, minimum number of test windows (20 or more) and of training points, random seed.

## 5. Criterion (fixed)
The exact rule for "passes", with the multiple-testing correction if there is more than one case. Example: the lower bound of the stationary-bootstrap 95% interval of the effectiveness is above zero **and** the 5% CVaR does not get worse. Always report the variance **and** the CVaR reduction. When the decision is about money, costs enter before the verdict. With several variants (thresholds, windows, models), also report the probability of backtest overfitting and the deflated Sharpe ratio, with their DOIs checked.

## 6. Hypothesis stated before
What you expect, in numbers. You will compare it with the result.

## 7. Limits declared
What the test does not cover: costs, taxes, liquidity, the gap between the model and the real contract.

## 8. Result (filled after the run)
The table, the verdict against section 5, whether section 6 held, what stays unknown, and the running count of tests already made on the same series.

## 9. Amendments
An amendment written before any result restarts the wait. An amendment after the result is allowed only as a declared check and does not change the verdict.
