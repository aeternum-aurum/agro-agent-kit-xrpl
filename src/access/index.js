// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 AETERNUM AURUM PARTNERS
/**
 * Module 4 — Access for agents: a read-only MCP server for class records, and pay-per-query (x402-style) on the XRP Ledger.
 *
 * MCP: a minimal JSON-RPC handler (initialize, ping, tools/list, tools/call), no SDK needed; serve it over stdio or HTTP.
 * x402 on XRPL (NON-STANDARD ADAPTATION): x402 was born on EVM chains with signed authorizations and a facilitator. Here the
 * agent pays first on the XRPL with the invoice id in a memo, then repeats the request with an X-PAYMENT header carrying the
 * transaction hash; the server verifies the transaction by READING the ledger (no keys on the server). The 402 body follows the
 * x402 shape (x402Version, accepts[]).
 */
import crypto from "node:crypto";
import { recordHash } from "../oracle/index.js";

const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const NOTICE = "data with source and method; not investment advice";
const hexAscii = (s) => Buffer.from(String(s), "ascii").toString("hex").toUpperCase();
class RpcError extends Error { constructor(code, message) { super(message); this.code = code; } }

/** MCP tools from class records: one `get_<indicator>` per record, plus `get_proof` (record hash and on-ledger publications) */
export function toolsFromRecords(records, publications = []) {
  const tools = records.map((r) => ({
    name: `get_${r.indicator.toLowerCase()}`,
    description: `${r.indicator} (classes) for ${r.reference}, with source and date. ${r.example ? "EXAMPLE VALUE. " : ""}${NOTICE}.`,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: () => ({ indicator: r.indicator, reference: r.reference, values: r.values, classes: r.classes, source: r.source, issued_at: r.issued_at, example: !!r.example, record_sha256: recordHash(r), notice: NOTICE }),
  }));
  const names = records.map((r) => r.indicator);
  tools.push({
    name: "get_proof",
    description: "Provenance of an indicator: sha256 of the canonical record and the ledger transactions where it was published.",
    inputSchema: { type: "object", properties: { indicator: { type: "string", enum: names } }, required: ["indicator"], additionalProperties: false },
    run: ({ indicator }) => {
      const r = records.find((x) => x.indicator === indicator);
      if (!r) throw new RpcError(-32602, "unknown indicator");
      return { indicator, record_sha256: recordHash(r), publications: publications.filter((p) => p.indicator === indicator), notice: NOTICE };
    },
  });
  return tools;
}

/** a JSON-RPC MCP handler: (message) -> response object, or null for notifications */
export function createMcpHandler({ name, version, tools }) {
  return function handle(msg) {
    const id = msg?.id ?? null;
    const isNotification = msg && !("id" in msg);
    try {
      if (msg?.jsonrpc !== "2.0" || typeof msg.method !== "string") throw new RpcError(-32600, "invalid request");
      if (isNotification) return null;
      const ok = (result) => ({ jsonrpc: "2.0", id, result });
      switch (msg.method) {
        case "initialize": return ok({ protocolVersion: PROTOCOLS.includes(msg.params?.protocolVersion) ? msg.params.protocolVersion : PROTOCOLS[0], capabilities: { tools: { listChanged: false } }, serverInfo: { name, version } });
        case "ping": return ok({});
        case "tools/list": return ok({ tools: tools.map(({ run, ...t }) => t) });
        case "tools/call": {
          const t = tools.find((x) => x.name === msg.params?.name);
          if (!t) throw new RpcError(-32602, `unknown tool: ${msg.params?.name}`);
          const args = msg.params?.arguments ?? {};
          const extra = Object.keys(args).filter((k) => !(k in (t.inputSchema.properties ?? {})));
          if (extra.length) throw new RpcError(-32602, `argument not in schema: ${extra.join(", ")}`);
          for (const k of t.inputSchema.required ?? []) if (!(k in args)) throw new RpcError(-32602, `missing argument: ${k}`);
          const out = t.run(args);
          return ok({ content: [{ type: "text", text: JSON.stringify(out) }], structuredContent: out, isError: false });
        }
        default: throw new RpcError(-32601, `method not supported: ${msg.method}`);
      }
    } catch (e) {
      if (isNotification) return null;
      return { jsonrpc: "2.0", id, error: { code: e instanceof RpcError ? e.code : -32603, message: e instanceof RpcError ? e.message : "internal error" } };
    }
  };
}

// ---------------------------------------------------------------- x402 on XRPL ----------------------------------------------------------------
export const X402_NETWORK = "xrpl-testnet";
export const MEMO_TYPE = hexAscii("x402/invoice");

/** an invoice: random id, price (integer, token units), payee and token, valid for `ttl` seconds */
export function createInvoice({ resource, price, payTo, currency, issuer, now, ttl = 300, network = X402_NETWORK }) {
  if (!Number.isInteger(price) || price <= 0) throw new Error("price must be a positive integer");
  return { id: crypto.randomBytes(12).toString("hex"), resource, price, payTo, currency, issuer, network, validUntil: now + ttl };
}

/** the 402 response body, in the x402 shape */
export function paymentRequired(inv, error = "payment required") {
  return { x402Version: 1, error, accepts: [{ scheme: "exact", network: inv.network, resource: inv.resource, mimeType: "application/json", maxAmountRequired: String(inv.price), payTo: inv.payTo, maxTimeoutSeconds: inv.validUntil, asset: { currency: inv.currency, issuer: inv.issuer }, extra: { invoice: inv.id, memoType: MEMO_TYPE, memoData: hexAscii(inv.id) } }] };
}

export const encodePaymentHeader = (hash, invoice, network = X402_NETWORK) => Buffer.from(JSON.stringify({ x402Version: 1, scheme: "exact", network, payload: { hash, invoice } })).toString("base64");
export function decodePaymentHeader(header, network = X402_NETWORK) {
  const p = JSON.parse(Buffer.from(String(header ?? ""), "base64").toString("utf8"));
  if (p?.x402Version !== 1 || p.network !== network || !/^[0-9A-F]{64}$/.test(p.payload?.hash ?? "")) throw new Error("invalid X-PAYMENT");
  return p.payload;
}

/** verifies a `tx` command result against the invoice; `used` is a Set of accepted hashes (replay protection) */
export function verifyPayment(tx, inv, used, now) {
  const no = (reason) => ({ ok: false, reason });
  if (!inv) return no("unknown invoice");
  if (now > inv.validUntil) return no("invoice expired");
  const t = tx?.tx_json ?? tx;
  const hash = tx?.hash ?? t?.hash;
  if (!tx?.validated) return no("transaction not validated");
  if (used.has(hash)) return no("payment already used");
  if (t?.TransactionType !== "Payment") return no("not a Payment");
  if (tx.meta?.TransactionResult !== "tesSUCCESS") return no("transaction did not succeed");
  if (t.Destination !== inv.payTo) return no("wrong destination");
  const d = tx.meta?.delivered_amount; // what was actually delivered, not what was asked
  if (typeof d !== "object" || d.currency !== inv.currency || d.issuer !== inv.issuer) return no("wrong token");
  if (!(Number(d.value) >= inv.price)) return no("delivered less than the price");
  const memo = (t.Memos ?? []).map((m) => m.Memo).find((m) => m?.MemoType === MEMO_TYPE);
  if (!memo || memo.MemoData !== hexAscii(inv.id)) return no("memo does not carry the invoice id");
  return { ok: true, reason: "paid" };
}

/**
 * The buyer's rule for data purchases: pay only listed payees and resources, never above the max price, at most N per day,
 * and no retry on the same day after a refusal or failure.
 * @param {{payees: string[], resources: string[], maxPrice: number, maxPerDay: number}} rule
 * @param {{payTo: string, resource: string, price: number, network: string}} offer  from the 402 body
 * @param {{day: string, paid: boolean}[]} log  previous attempts
 */
export function shouldBuy(rule, offer, log, today, network = X402_NETWORK) {
  const no = (reason) => ({ buy: false, reason });
  if (offer?.network !== network) return no(`network must be ${network}`);
  if (!rule.payees.includes(offer.payTo)) return no("payee not in the rule");
  if (!rule.resources.includes(offer.resource)) return no("resource not in the rule");
  if (!Number.isInteger(offer.price) || offer.price <= 0 || offer.price > rule.maxPrice) return no(`price above the rule (${rule.maxPrice})`);
  const todays = log.filter((l) => l.day === today);
  if (todays.some((l) => !l.paid)) return no("no retry today after a refusal or failure");
  if (todays.filter((l) => l.paid).length >= rule.maxPerDay) return no(`daily purchases used up (${rule.maxPerDay})`);
  return { buy: true, reason: "within the rule" };
}
