// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 AETERNUM AURUM PARTNERS
/**
 * Module 2b — Conditional settlement: an escrow that only the deciding agent can release, and only when the data matches.
 *
 * Lesson learned on Testnet: an escrow with only FinishAfter/CancelAfter can be finished by ANY account after FinishAfter, so an
 * off-ledger rule ("release only if the oracle class and the credential match") is not enforced by the ledger. Fix: put a
 * PREIMAGE-SHA-256 crypto-condition on the escrow; keep the preimage in the agent's memory only; finish with the fulfillment
 * after the decision; discard the preimage when the decision is "no", so the escrow can only be cancelled after CancelAfter.
 *
 * Issued (trust line) tokens can be escrowed when the issuer has asfAllowTrustLineLocking (TokenEscrow amendment).
 * DER encoding: fulfillment = A0 <len> 80 <len(p)> p ; condition = A0 25 80 20 sha256(p) 81 01 <cost = len(p)>.
 */
import crypto from "node:crypto";

export const RIPPLE_EPOCH = 946684800;
export const ASF_ALLOW_TRUSTLINE_LOCKING = 17;

/** condition and fulfillment for a given preimage (Buffer, up to 127 bytes) */
export function preimageCondition(preimage) {
  if (!Buffer.isBuffer(preimage) || preimage.length > 127) throw new Error("preimage: Buffer of at most 127 bytes");
  const fulfillment = Buffer.concat([Buffer.from([0xa0, preimage.length + 2, 0x80, preimage.length]), preimage]);
  const fingerprint = crypto.createHash("sha256").update(preimage).digest();
  const condition = Buffer.concat([Buffer.from([0xa0, 0x25, 0x80, 0x20]), fingerprint, Buffer.from([0x81, 0x01, preimage.length])]);
  return { condition: condition.toString("hex").toUpperCase(), fulfillment: fulfillment.toString("hex").toUpperCase() };
}

/** a fresh random condition; keep `fulfillment` in memory only, never in a file, log or database */
export function newCondition() {
  return preimageCondition(crypto.randomBytes(32));
}

/** issuer setting that allows its token to be escrowed */
export const allowTokenEscrow = (issuer) => ({ TransactionType: "AccountSet", Account: issuer, SetFlag: ASF_ALLOW_TRUSTLINE_LOCKING });

/** EscrowCreate with a mandatory condition; times in Unix seconds */
export function buildConditionalEscrow({ from, to, amount, finishAfter, cancelAfter, condition }) {
  if (!/^A0258020[0-9A-F]{64}8101[0-9A-F]{2}$/.test(String(condition ?? ""))) throw new Error("a PREIMAGE-SHA-256 condition is required: without it anyone can finish after FinishAfter");
  if (!(Number.isInteger(finishAfter) && Number.isInteger(cancelAfter) && cancelAfter > finishAfter)) throw new Error("cancelAfter must be after finishAfter");
  return { TransactionType: "EscrowCreate", Account: from, Destination: to, Amount: amount, FinishAfter: finishAfter - RIPPLE_EPOCH, CancelAfter: cancelAfter - RIPPLE_EPOCH, Condition: condition };
}
export const buildFinish = ({ by, owner, sequence, condition, fulfillment }) => ({ TransactionType: "EscrowFinish", Account: by, Owner: owner, OfferSequence: sequence, Condition: condition, Fulfillment: fulfillment });
export const buildCancel = ({ by, owner, sequence }) => ({ TransactionType: "EscrowCancel", Account: by, Owner: owner, OfferSequence: sequence });

/**
 * The release decision. Pure.
 * @param {{credential: {type: string, validUntil: string}|null, requiredType: string, oracleClass: number|null, maxClass: number, today: string}} c
 */
export function decideRelease(c) {
  const no = (reason) => ({ release: false, reason });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(c.today ?? ""))) return no("today must be YYYY-MM-DD");
  if (!c.credential || c.credential.type !== c.requiredType) return no(`counterparty has no active ${c.requiredType} credential`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(c.credential.validUntil ?? "")) || c.credential.validUntil < c.today) return no("credential expired");
  if (!Number.isInteger(c.oracleClass)) return no("oracle class not read");
  if (c.oracleClass > c.maxClass) return no(`oracle class ${c.oracleClass} above the agreed maximum (${c.maxClass})`);
  return { release: true, reason: "credential active and oracle class within the agreed maximum" };
}
