// SPDX-License-Identifier: Apache-2.0
// Buyer agent: asks for the indicator, gets 402, checks its own rule (shouldBuy), pays on XRPL Testnet with the invoice id in the memo,
// and repeats the request with X-PAYMENT. Without --send it stops before signing. Seed from KIT_XRPL_SEED, never printed.
// Env: KIT_XRPL_SEED, KIT_X402_PAYTO (the only payee the rule accepts). Usage: node examples/x402-agent.js [--send]
import { Client, Wallet } from "xrpl";
import { encodePaymentHeader, shouldBuy } from "../src/access/index.js";
import { exampleNetwork } from "./testnet.js";

const ENDPOINT = "http://127.0.0.1:4020/indicator/enso_phase";
const rule = { payees: [process.env.KIT_X402_PAYTO], resources: ["/indicator/enso_phase"], maxPrice: 10, maxPerDay: 3 }; // illustrative numbers: write your own rule
const today = new Date().toISOString().slice(0, 10);
const log = []; // keep your attempts in durable storage in real use

const r1 = await fetch(ENDPOINT);
if (r1.status !== 402) throw new Error(`expected 402, got ${r1.status}`);
const offer = (await r1.json()).accepts[0];
const d = shouldBuy(rule, { payTo: offer.payTo, resource: offer.resource, price: Number(offer.maxAmountRequired), network: offer.network }, log, today);
console.log(`402: ${offer.maxAmountRequired} for ${offer.payTo}; rule says ${d.buy ? "BUY" : "REFUSE"} (${d.reason})`);
if (!d.buy || !process.argv.includes("--send")) process.exit(0);

const wallet = Wallet.fromSeed(process.env.KIT_XRPL_SEED);
const client = new Client(exampleNetwork());
await client.connect();
try {
  const tx = await client.autofill({ TransactionType: "Payment", Account: wallet.classicAddress, Destination: offer.payTo, Amount: { ...offer.asset, value: offer.maxAmountRequired }, Memos: [{ Memo: { MemoType: offer.extra.memoType, MemoData: offer.extra.memoData } }] });
  const res = await client.submitAndWait(wallet.sign(tx).tx_blob);
  console.log(`paid: ${res.result.meta?.TransactionResult} ${res.result.hash}`);
  const r2 = await fetch(ENDPOINT, { headers: { "x-payment": encodePaymentHeader(res.result.hash, offer.extra.invoice) } });
  console.log(`server: ${r2.status}`, await r2.json());
} finally {
  await client.disconnect();
}
