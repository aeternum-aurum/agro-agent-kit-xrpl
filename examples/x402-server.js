// SPDX-License-Identifier: Apache-2.0
// Pay-per-query server, LOCAL ONLY (127.0.0.1:4020). GET /indicator/enso_phase answers 402 with an invoice; with a valid X-PAYMENT
// header it reads the payment on XRPL Testnet (no keys here) and answers 200 with the record.
// Env: KIT_X402_PAYTO (your payee address), KIT_X402_ISSUER and KIT_X402_CURRENCY (the test token), KIT_X402_PRICE (default 5).
import fs from "node:fs";
import http from "node:http";
import { Client } from "xrpl";
import { createInvoice, decodePaymentHeader, paymentRequired, verifyPayment } from "../src/access/index.js";
import { currencyCode } from "../src/oracle/index.js";
import { exampleNetwork } from "./testnet.js";

const record = JSON.parse(fs.readFileSync(new URL("./enso-record.json", import.meta.url), "utf8"));
const cfg = { payTo: process.env.KIT_X402_PAYTO, issuer: process.env.KIT_X402_ISSUER, currency: currencyCode(process.env.KIT_X402_CURRENCY ?? "TEST"), price: Number(process.env.KIT_X402_PRICE ?? 5) };
if (!cfg.payTo || !cfg.issuer) throw new Error("set KIT_X402_PAYTO and KIT_X402_ISSUER");
const client = new Client(exampleNetwork());
await client.connect();
const invoices = new Map(), used = new Set(); // in memory: persist both before running for real
const now = () => Math.floor(Date.now() / 1000);
const send = (res, status, body, headers = {}) => { res.writeHead(status, { "content-type": "application/json", ...headers }); res.end(JSON.stringify(body)); };

http.createServer(async (req, res) => {
  if (req.method !== "GET" || req.url !== "/indicator/enso_phase") return send(res, 404, { error: "not found" });
  const header = req.headers["x-payment"];
  if (!header) {
    const inv = createInvoice({ resource: req.url, price: cfg.price, payTo: cfg.payTo, currency: cfg.currency, issuer: cfg.issuer, now: now() });
    invoices.set(inv.id, inv);
    return send(res, 402, paymentRequired(inv));
  }
  let p;
  try { p = decodePaymentHeader(header); } catch { return send(res, 400, { error: "invalid X-PAYMENT" }); }
  const inv = invoices.get(p.invoice);
  let tx = null;
  try { tx = (await client.request({ command: "tx", transaction: p.hash })).result; } catch { tx = null; }
  const v = verifyPayment(tx, inv, used, now());
  if (!v.ok) return send(res, 402, inv ? paymentRequired(inv, v.reason) : { x402Version: 1, error: v.reason, accepts: [] });
  used.add(p.hash);
  invoices.delete(inv.id);
  send(res, 200, record, { "x-payment-response": Buffer.from(JSON.stringify({ success: true, transaction: p.hash })).toString("base64") });
}).listen(4020, "127.0.0.1", () => console.log("x402 example on http://127.0.0.1:4020/indicator/enso_phase"));
