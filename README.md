# AETERNUM Agro Agent Kit for the XRP Ledger

*Open building blocks for agents that read agro data, decide under a written mandate, and pay on the XRP Ledger.*
By **AETERNUM AURUM PARTNERS** · Apache-2.0 · version 0.3.0 · [Português](README.pt-BR.md)

> **Status:** 0.3, Testnet examples only. Nothing here is investment advice. The examples use public data (NOAA/CPC, NASA POWER) and fictitious values clearly marked as examples.

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
| 5 | `multichain` | **Read-only:** the same class record on Stellar Testnet (1-byte data entries, memo hash) and XDC Apothem (`eth_call`), verified against the same record hash; no keys, no extra dependency | — (Stellar, XDC) |
| 6 | `receipt` | A **verified domain** (Credential + Permissioned Domain) and a **lot receipt** as an MPT with RequireAuth (1 unit = 1 bag; short XLS-89 metadata with the hash of the full lot file); membership checked on ledger before the issuer authorizes a holder | Credentials, Permissioned Domains, MPT |

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

### Module 5 — one record, three ledgers (read-only)
```
node examples/read-multichain.js GABV43A5IUUNNYW6RX7N7KDA7K5UBBHBWAB3RDMSENCRAJ7AXH5ZQUS5   2d2343816732db250ef55ea42e64a1d342d53276781a01d705dabfccd9125103   0x816919326C8f51E9BE93df4De4D023689368a26b ENSO_FASE ENSO_FASE,ENSO_INT [record.json]
```
Stellar: each class is a 1-byte account data entry and the publishing transaction carries a memo of type `hash` = sha256 of the canonical record (the same hash as the XRPL oracle URI). XDC: a minimal contract read through `eth_call` (`registros(bytes32)`, selector `0x762849cc`); an optional last field carries the same record hash. `verifyAcrossLedgers(record, read)` names every mismatch.

### Module 6 — verified domain and lot receipt (dry run)
```
node examples/receipt-dry-run.js <issuer address> <holder address>   # builds the 7 transactions; signs nothing
```
On Testnet (Nov 2026) an MPT issuance with `DomainID` was refused (`temDISABLED`), so the receipt uses **plan B**: the issuer authorizes each holder one by one, after `isMember()` reads the holder's credential on ledger. In both plans the ledger enforces it (`RequireAuth`): a non-member receiving the MPT fails with `tecNO_AUTH`. **A token receipt for a real lot is a legal question in each jurisdiction; this module is a demonstration pattern.**

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
- Done in 0.2: conditional settlement (`settlement`, module 2b): escrow with a PREIMAGE-SHA-256 condition, released only by the deciding agent when the oracle class and the credential match.
- Done in 0.3: reading the same class oracle on Stellar and XDC testnets (Module 5); verified domain and an MPT lot receipt (Module 6).

## License
Apache License 2.0 — see [LICENSE](LICENSE) and [NOTICE](NOTICE). © 2026 AETERNUM AURUM PARTNERS.
