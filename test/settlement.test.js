// SPDX-License-Identifier: Apache-2.0
// Module 2b tests: no network, no keys (throwaway wallets in memory).
import { test } from "node:test";
import assert from "node:assert/strict";
import { Wallet, decode } from "xrpl";
import { RIPPLE_EPOCH, allowTokenEscrow, buildCancel, buildConditionalEscrow, buildFinish, decideRelease, newCondition, preimageCondition } from "../src/settlement/index.js";

const ISSUER = Wallet.generate(), PAYER = Wallet.generate(), PAYEE = Wallet.generate();
const fixed = { Fee: "12", Sequence: 5, LastLedgerSequence: 100, Flags: 0 };
const sign = (w, tx) => decode(w.sign({ ...tx, ...fixed }).tx_blob);
const T0 = 1794950000;
const token = { currency: "TST", issuer: ISSUER.classicAddress, value: "100" };

test("PREIMAGE-SHA-256 matches the crypto-conditions test vector (empty preimage)", () => {
  assert.deepEqual(preimageCondition(Buffer.alloc(0)), { condition: "A0258020E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855810100", fulfillment: "A0028000" });
  const c = newCondition();
  assert.ok(c.condition.endsWith("810120") && c.fulfillment.startsWith("A0228020"));
});

test("escrow requires a condition and ordered times; it signs", () => {
  const c = newCondition();
  assert.throws(() => buildConditionalEscrow({ from: PAYER.classicAddress, to: PAYEE.classicAddress, amount: token, finishAfter: T0 + 60, cancelAfter: T0 + 600 }));
  assert.throws(() => buildConditionalEscrow({ from: PAYER.classicAddress, to: PAYEE.classicAddress, amount: token, finishAfter: T0 + 600, cancelAfter: T0 + 60, condition: c.condition }));
  const d = sign(PAYER, buildConditionalEscrow({ from: PAYER.classicAddress, to: PAYEE.classicAddress, amount: token, finishAfter: T0 + 60, cancelAfter: T0 + 600, condition: c.condition }));
  assert.deepEqual([d.TransactionType, d.Condition, d.FinishAfter], ["EscrowCreate", c.condition, T0 + 60 - RIPPLE_EPOCH]);
});

test("finish with fulfillment, cancel and the issuer flag all sign", () => {
  const c = newCondition();
  assert.equal(sign(PAYER, buildFinish({ by: PAYER.classicAddress, owner: PAYER.classicAddress, sequence: 9, ...c })).Fulfillment, c.fulfillment);
  assert.equal(sign(PAYER, buildCancel({ by: PAYER.classicAddress, owner: PAYER.classicAddress, sequence: 9 })).OfferSequence, 9);
  assert.equal(sign(ISSUER, allowTokenEscrow(ISSUER.classicAddress)).SetFlag, 17);
});

test("release decision", () => {
  const base = { credential: { type: "CARRIER", validUntil: "2027-01-31" }, requiredType: "CARRIER", oracleClass: 2, maxClass: 2, today: "2026-11-18" };
  assert.equal(decideRelease(base).release, true);
  assert.equal(decideRelease({ ...base, maxClass: 1 }).reason, "oracle class 2 above the agreed maximum (1)");
  assert.equal(decideRelease({ ...base, credential: null }).release, false);
  assert.equal(decideRelease({ ...base, credential: { type: "CARRIER", validUntil: "2026-11-01" } }).reason, "credential expired");
  assert.equal(decideRelease({ ...base, oracleClass: null }).reason, "oracle class not read");
});
