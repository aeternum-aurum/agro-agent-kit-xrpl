# AETERNUM Agro Agent Kit for the XRP Ledger

*Open building blocks for agents that read agro data, decide under a written mandate, and pay on the XRP Ledger.*
By **AETERNUM AURUM PARTNERS** · Apache-2.0 · version 0.1.0 · [Português](README.pt-BR.md)

> **Status:** 0.1, Testnet examples only. Nothing here is investment advice. The examples use public data (NOAA/CPC, NASA POWER) and fictitious values clearly marked as examples.

## Why
Agents that move money in agricultural trade need three things before they pay anyone:

1. **data they can verify**: a measured indicator with source, date and a hash anyone can check;
2. **a counterparty that was verified**: an on-ledger credential, accepted and still valid;
3. **a limit written down before they run**: per payment, per day, per counterparty, per week, per year.

This kit gives you those three pieces, plus a way for other agents to query and pay for the data.

## Modules
| # | Module | What it does | XRPL features |
|---|---|---|---|
| 1 | `oracle` | Publish agro **classes** (e.g. ENSO phase, rainfall vs normal) — never prices — to an on-ledger oracle, with the sha256 of the source record in the URI; read it back and verify | PriceOracle (XLS-47) |
| 2 | `mandate` | An open format for spending rules and an engine that answers **PAY** or **REFUSE** with the reason; reads the counterparty's credential on ledger; builds the payment | Credentials, issued tokens |
| 3 | `quant/` (Python) | Methods for agents that hedge and settle: minimum-variance hedge ratio with out-of-sample tests, FX risk by settlement horizon, carrying and transit costs, a pre-registration protocol; public series only (see [`quant/README.md`](quant/README.md)) | — |
| 4 | `access` | A read-only **MCP server** for the class records, and **pay-per-query** (x402-style) settled on the XRPL | Payments, memos |

## Quick start
Requires Node.js 20+.
```
npm install            # only dependency: xrpl 5.3.0
npm test               # 25 tests, no network, no keys
cd quant && python -m pytest -q tests   # module 3: 13 tests (needs numpy)
```

### Module 1 — publish and verify a class oracle (Testnet)
```
# dry run: builds and autofills, signs nothing
KIT_XRPL_SEED=<your Testnet seed> node examples/publish-oracle.js examples/enso-record.json
# send, then read back and verify hash and values
KIT_XRPL_SEED=<your Testnet seed> node examples/publish-oracle.js examples/enso-record.json --send
# read anyone's oracle (no keys)
node examples/read-oracle.js <account> <documentId> [record.json]
```
Field rules we learned on Testnet and built into the code:
- a class is stored as `AssetPrice = class × 10` with `Scale = 1` (xrpl.js 5.3.0 refuses an explicit `Scale` of 0 and requires `Scale` with `AssetPrice`);
- `AssetClass` up to 8 ASCII chars; `LastUpdateTime` in Unix seconds;
- every update must resend every pair (a pair left out loses its value); to delete a pair, send it without `AssetPrice`/`Scale`;
- the `URI` carries `sha256:<hash of the canonical record>`, so anyone holding the record file can check the ledger.

### Module 2 — decide under a mandate
```js
import { freezeMandate, readCredential, evaluate, buildPayment } from "aeternum-agro-agent-kit/mandate";
const m = freezeMandate(myMandate);                 // write it BEFORE the agent runs; frozen, reviewed as diffs
const cred = await readCredential(client, carrier, m.counterparty.credential.issuer, m.counterparty.credential.type);
const d = evaluate(m, request, paidLog, cred, today); // { allow, reason }
if (d.allow) { /* sign and submit buildPayment(m, agent, request) */ } else { /* log d.reason; no transaction */ }
```
See `examples/mandate-freight.json` (illustrative numbers).

### Module 4 — MCP and pay-per-query
```
node examples/mcp-server.js                 # stdio MCP server: get_enso_phase, get_rain_class_ex, get_proof
KIT_X402_PAYTO=<payee> KIT_X402_ISSUER=<token issuer> node examples/x402-server.js     # local only, 127.0.0.1:4020
KIT_XRPL_SEED=<agent seed> KIT_X402_PAYTO=<payee> node examples/x402-agent.js [--send]
```
**x402 on XRPL is a non-standard adaptation.** x402 was born on EVM chains with signed authorizations and a facilitator. Here the agent pays first on the XRPL with the invoice id in a memo, then repeats the request with an `X-PAYMENT` header carrying the transaction hash. The server verifies by reading the ledger: validated, `tesSUCCESS`, destination, **delivered** amount and token, memo, not reused, not expired. The server holds no keys.

## Live on XRPL Testnet (17 Nov 2026)
Built with this approach by AETERNUM AURUM PARTNERS. Values are Testnet, test tokens with no value:
- class oracle with the ENSO phase and an example risk class (`RISCO_EX_…`), each with the record hash in the URI;
- an agent that paid a verified carrier inside its mandate, and refused an over-limit request and an unverified counterparty, without sending a transaction;
- a pay-per-query purchase of the ENSO indicator: 402 → payment → 200;
- conditional escrows released only by the deciding agent (one released, one cancelled and refunded);
- a fictitious coffee lot as an MPT receipt that only a verified holder could receive (the ledger refused an unverified one).

Transaction hashes are listed in [`docs/testnet-evidence.md`](docs/testnet-evidence.md).

## What this kit is NOT
- not a source of data: the records in `examples/` are illustrative; publish your own measured data;
- no proprietary models, calibrations, regional risk classifications, price data or customer data;
- no custody, exchange or investment service; the mandate engine decides only within rules you write;
- not audited for Mainnet. Using it on Mainnet is your decision and your responsibility.

## Roadmap
- 0.2: escrow released only when the oracle class and the credential match; Permissioned Domains; a fictitious coffee lot as an MPT receipt with metadata hash (XLS-89).
- Conditional settlement (`settlement`, module 2b) is in 0.2: escrow with a PREIMAGE-SHA-256 condition, released only by the deciding agent.

## License
Apache License 2.0 — see [LICENSE](LICENSE) and [NOTICE](NOTICE). © 2026 AETERNUM AURUM PARTNERS.
