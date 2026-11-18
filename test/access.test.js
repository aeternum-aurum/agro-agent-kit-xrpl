// SPDX-License-Identifier: Apache-2.0
// Module 4 tests: no network, no keys.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Wallet } from "xrpl";
import { MEMO_TYPE, createInvoice, createMcpHandler, decodePaymentHeader, encodePaymentHeader, paymentRequired, shouldBuy, toolsFromRecords, verifyPayment } from "../src/access/index.js";
import { recordHash } from "../src/oracle/index.js";

const read = (f) => JSON.parse(fs.readFileSync(new URL(f, import.meta.url), "utf8"));
const records = [read("../examples/enso-record.json"), read("../examples/rain-class-example.json")];
const handle = createMcpHandler({ name: "t", version: "0", tools: toolsFromRecords(records, [{ indicator: "ENSO_PHASE", network: "xrpl-testnet", hash: "A".repeat(64) }]) });
const call = (method, params, id = 1) => handle({ jsonrpc: "2.0", id, method, params });

test("MCP: initialize, tools from records, notifications get no reply", () => {
  assert.equal(call("initialize", { protocolVersion: "2025-06-18" }).result.protocolVersion, "2025-06-18");
  assert.deepEqual(call("tools/list").result.tools.map((t) => t.name), ["get_enso_phase", "get_rain_class_ex", "get_proof"]);
  assert.equal(handle({ jsonrpc: "2.0", method: "notifications/initialized" }), null);
});

test("MCP: answers carry source, hash and notice; example values are flagged", () => {
  const e = call("tools/call", { name: "get_enso_phase", arguments: {} }).result.structuredContent;
  assert.equal(e.values.phase, 1);
  assert.equal(e.record_sha256, recordHash(records[0]));
  assert.match(e.notice, /not investment advice/);
  assert.equal(call("tools/call", { name: "get_rain_class_ex", arguments: {} }).result.structuredContent.example, true);
  assert.equal(call("tools/call", { name: "get_proof", arguments: { indicator: "ENSO_PHASE" } }).result.structuredContent.publications.length, 1);
});

test("MCP: errors for unknown tool, extra or missing argument, bad request, unknown method", () => {
  assert.equal(call("tools/call", { name: "get_price", arguments: {} }).error.code, -32602);
  assert.equal(call("tools/call", { name: "get_enso_phase", arguments: { x: 1 } }).error.code, -32602);
  assert.equal(call("tools/call", { name: "get_proof", arguments: {} }).error.code, -32602);
  assert.equal(handle({ id: 1, method: "ping" }).error.code, -32600);
  assert.equal(call("resources/list").error.code, -32601);
});

test("MCP over stdio: a real child process answers", async () => {
  const child = spawn(process.execPath, [fileURLToPath(new URL("../examples/mcp-server.js", import.meta.url))], { stdio: ["pipe", "pipe", "inherit"] });
  const lines = [];
  child.stdout.on("data", (d) => lines.push(...d.toString().split("\n").filter(Boolean)));
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_enso_phase", arguments: {} } }) + "\n");
  child.stdin.end();
  await new Promise((r) => child.on("close", r));
  assert.equal(JSON.parse(lines[0]).result.structuredContent.values.phase, 1);
});

const PAYEE = Wallet.generate().classicAddress, ISSUER = Wallet.generate().classicAddress, NOW = 1794930000, H = "B".repeat(64);
const inv = { ...createInvoice({ resource: "/indicator/enso_phase", price: 5, payTo: PAYEE, currency: "TEST", issuer: ISSUER, now: NOW }), id: "abc" };
const good = { hash: H, validated: true, tx_json: { TransactionType: "Payment", Destination: PAYEE, Memos: [{ Memo: { MemoType: MEMO_TYPE, MemoData: Buffer.from("abc").toString("hex").toUpperCase() } }] }, meta: { TransactionResult: "tesSUCCESS", delivered_amount: { currency: "TEST", issuer: ISSUER, value: "5" } } };
const tweak = (f) => { const t = structuredClone(good); f(t); return t; };

test("x402: 402 body in the x402 shape and header round trip", () => {
  const b = paymentRequired(inv);
  assert.equal(b.x402Version, 1);
  assert.equal(b.accepts[0].extra.invoice, "abc");
  assert.deepEqual(decodePaymentHeader(encodePaymentHeader(H, "abc")), { hash: H, invoice: "abc" });
  assert.throws(() => decodePaymentHeader("garbage"));
});

test("x402: verification accepts the right payment and rejects every deviation", () => {
  assert.equal(verifyPayment(good, inv, new Set(), NOW).ok, true);
  assert.equal(verifyPayment(tweak((t) => { t.tx_json.Destination = ISSUER; }), inv, new Set(), NOW).reason, "wrong destination");
  assert.equal(verifyPayment(tweak((t) => { t.meta.delivered_amount.value = "4"; }), inv, new Set(), NOW).reason, "delivered less than the price");
  assert.equal(verifyPayment(tweak((t) => { t.meta.delivered_amount = "5000000"; }), inv, new Set(), NOW).reason, "wrong token");
  assert.equal(verifyPayment(tweak((t) => { t.tx_json.Memos = []; }), inv, new Set(), NOW).reason, "memo does not carry the invoice id");
  assert.equal(verifyPayment(good, inv, new Set([H]), NOW).reason, "payment already used");
  assert.equal(verifyPayment(good, inv, new Set(), NOW + 301).reason, "invoice expired");
  assert.equal(verifyPayment(tweak((t) => { t.validated = false; }), inv, new Set(), NOW).reason, "transaction not validated");
});

test("x402: the buyer rule", () => {
  const rule = { payees: [PAYEE], resources: ["/indicator/enso_phase"], maxPrice: 10, maxPerDay: 3 }; // illustrative numbers
  const offer = { payTo: PAYEE, resource: "/indicator/enso_phase", price: 5, network: "xrpl-testnet" };
  assert.equal(shouldBuy(rule, offer, [], "2026-11-17").buy, true);
  assert.equal(shouldBuy(rule, { ...offer, price: 11 }, [], "2026-11-17").reason, "price above the rule (10)");
  assert.equal(shouldBuy(rule, { ...offer, payTo: ISSUER }, [], "2026-11-17").reason, "payee not in the rule");
  const three = [1, 2, 3].map(() => ({ day: "2026-11-17", paid: true }));
  assert.equal(shouldBuy(rule, offer, three, "2026-11-17").reason, "daily purchases used up (3)");
  assert.equal(shouldBuy(rule, offer, [{ day: "2026-11-17", paid: false }], "2026-11-17").reason, "no retry today after a refusal or failure");
});
