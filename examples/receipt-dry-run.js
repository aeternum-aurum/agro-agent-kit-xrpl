// SPDX-License-Identifier: Apache-2.0
// Builds (does NOT sign or send) the verified-domain and lot-receipt transactions for given public addresses, so you can read them
// before running anything on Testnet. No keys. Usage: node examples/receipt-dry-run.js <issuer r...> <holder r...>
import { buildCredentialAccept, buildCredentialCreate, buildDelivery, buildDomainSet, buildIssuerAuthorize, buildOptIn, buildReceiptIssuance, credentialExpiration, decodeReceiptMetadata } from "../src/receipt/index.js";

const [issuer, holder] = process.argv.slice(2);
if (!holder) throw new Error("usage: receipt-dry-run.js <issuer address> <holder address>");
const spec = { demonstration: true, lot_id: "DEMO-LOT-001", season: "2026/27", unit: "bag 60 kg", bags: 100, region: "BR-MG" };
const today = new Date().toISOString().slice(0, 10);
const issuance = buildReceiptIssuance(issuer, spec);
const steps = [
  ["1 issuer attests MEMBER (30 days)", buildCredentialCreate(issuer, holder, "MEMBER", credentialExpiration(today, 30))],
  ["2 holder accepts", buildCredentialAccept(holder, issuer, "MEMBER")],
  ["3 issuer creates the Permissioned Domain", buildDomainSet(issuer, [{ issuer, type: "MEMBER" }])],
  ["4 issuer creates the receipt (MPT, RequireAuth)", issuance],
  ["5 holder opts in (issuance id comes from step 4's result)", buildOptIn(holder, "<MPTokenIssuanceID>")],
  ["6 issuer authorizes the holder AFTER isMember() on ledger", buildIssuerAuthorize(issuer, holder, "<MPTokenIssuanceID>", true)],
  ["7 issuer delivers 100 bags", buildDelivery(issuer, holder, "<MPTokenIssuanceID>", 100)],
];
for (const [what, tx] of steps) console.log(`${what}:\n${JSON.stringify(tx)}\n`);
console.log("metadata on ledger:", JSON.stringify(decodeReceiptMetadata(issuance.MPTokenMetadata)));
console.log("dry run only: nothing was signed or sent. A non-member receiving the MPT fails on ledger with tecNO_AUTH (see docs/testnet-evidence.md).");
