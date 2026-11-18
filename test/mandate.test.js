// SPDX-License-Identifier: Apache-2.0
// Module 2 tests: no network, no keys (throwaway wallets in memory).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Wallet, decode } from "xrpl";
import { LSF_ACCEPTED, RIPPLE_EPOCH, buildPayment, credentialFromLedger, evaluate, freezeMandate, isoWeek, validateMandate } from "../src/mandate/index.js";

const ISSUER = Wallet.generate(), CARRIER = Wallet.generate(), AGENT = Wallet.generate(), OTHER = Wallet.generate();
const base = JSON.parse(fs.readFileSync(new URL("../examples/mandate-freight.json", import.meta.url), "utf8"));
const m = freezeMandate({ ...base, asset: { currency: "TEST", issuer: ISSUER.classicAddress }, counterparty: { credential: { ...base.counterparty.credential, issuer: ISSUER.classicAddress } } });
const TODAY = "2026-11-17";
const cred = { issuer: ISSUER.classicAddress, type: "CARRIER", validUntil: "2027-01-31" };
const req = (amount, extra = {}) => ({ to: CARRIER.classicAddress, amount, units: 30, asset: "TEST", network: "testnet", reason: "freight test lot", ...extra });

test("the example mandate is valid and frozen deep", () => {
  assert.deepEqual(validateMandate(m), []);
  assert.ok(Object.isFrozen(m.limits) && Object.isFrozen(m.counterparty.credential));
  assert.throws(() => freezeMandate({ ...base, limits: { ...base.limits, perPayment: 5000 } }));
});

test("pays a verified counterparty within the limits", () => {
  assert.deepEqual(evaluate(m, req(900), [], cred, TODAY), { allow: true, reason: "within mandate" });
});

test("refuses: no credential, wrong issuer, wrong type, expired, too long", () => {
  assert.equal(evaluate(m, req(100), [], null, TODAY).reason, "counterparty has no accepted credential");
  assert.equal(evaluate(m, req(100), [], { ...cred, issuer: OTHER.classicAddress }, TODAY).reason, "credential from another issuer");
  assert.equal(evaluate(m, req(100), [], { ...cred, type: "BUYER" }, TODAY).reason, "credential type is not CARRIER");
  assert.equal(evaluate(m, req(100), [], { ...cred, validUntil: "2026-11-16" }, TODAY).reason, "credential expired");
  assert.equal(evaluate(m, req(100), [], { ...cred, validUntil: "2027-06-30" }, TODAY).reason, "credential valid for more than 90 days");
});

test("refuses: per payment, per unit, per day, per counterparty, count, week, year", () => {
  assert.equal(evaluate(m, req(1001, { units: 40 }), [], cred, TODAY).reason, "above the per-payment limit (1000)");
  assert.equal(evaluate(m, req(950, { units: 30 }), [], cred, TODAY).reason, "above the cap per tonne (30)");
  assert.equal(evaluate(m, req(500, { units: undefined }), [], cred, TODAY).reason, "request must state tonne");
  assert.equal(evaluate(m, req(900), [{ to: CARRIER.classicAddress, amount: 200, day: TODAY }], cred, TODAY).reason, "above the per-counterparty daily limit (1000)");
  assert.equal(evaluate(m, req(500), [{ to: OTHER.classicAddress, amount: 900, day: TODAY }, { to: OTHER.classicAddress, amount: 900, day: TODAY }], cred, TODAY).reason, "above the daily limit (2000)");
  const three = [1, 2, 3].map(() => ({ to: OTHER.classicAddress, amount: 10, day: TODAY }));
  assert.equal(evaluate(m, req(10), three, cred, TODAY).reason, "daily number of payments used up (3)");
  const week = ["2026-11-16", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21"].map((day) => ({ to: OTHER.classicAddress, amount: 1000, day }));
  assert.equal(evaluate(m, req(1), week.slice(0, 5), cred, TODAY).reason, "above the weekly limit (5000)");
  assert.equal(isoWeek("2026-11-17"), "2026-W47");
});

test("refuses without a reason, on another network or asset", () => {
  assert.equal(evaluate(m, req(10, { reason: " " }), [], cred, TODAY).reason, "a reason is required");
  assert.equal(evaluate(m, req(10, { network: "mainnet" }), [], cred, TODAY).reason, "network must be testnet");
  assert.equal(evaluate(m, req(10, { asset: "USD" }), [], cred, TODAY).reason, "asset must be TEST");
});

test("reads a credential from a ledger object only when accepted and with expiration", () => {
  const node = { LedgerEntryType: "Credential", Flags: LSF_ACCEPTED, Issuer: ISSUER.classicAddress, Subject: CARRIER.classicAddress, CredentialType: Buffer.from("CARRIER").toString("hex"), Expiration: Date.parse("2027-01-31T23:59:59Z") / 1000 - RIPPLE_EPOCH };
  assert.deepEqual(credentialFromLedger(node), cred);
  assert.equal(credentialFromLedger({ ...node, Flags: 0 }), null);
  assert.equal(credentialFromLedger({ ...node, Expiration: undefined }), null);
});

test("an allowed payment builds and signs (throwaway wallet, no network)", () => {
  const tx = buildPayment(m, AGENT.classicAddress, req(900));
  const d = decode(AGENT.sign({ ...tx, Fee: "12", Sequence: 1, LastLedgerSequence: 10, Flags: 0 }).tx_blob);
  assert.equal(d.Amount.value, "900");
  assert.equal(Buffer.from(d.Memos[0].Memo.MemoData, "hex").toString(), "freight test lot");
});
