// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 AETERNUM AURUM PARTNERS
/**
 * Module 6 — Verified domain and a lot receipt as an MPT (XRPL Testnet; transactions are built here, never sent).
 *
 *  - Verified domain: an issuer attests a credential type (e.g. MEMBER), the subject accepts it, and a Permissioned Domain accepts
 *    that credential. Holding the accepted, unexpired credential = being a member. No personal data goes on ledger.
 *  - Lot receipt: a Multi-Purpose Token (MPT) where 1 unit = 1 bag of the lot, issued with RequireAuth (only holders the issuer
 *    authorizes can hold it), CanTransfer and CanEscrow, AssetScale 0, MaximumAmount = number of bags. The on-ledger metadata is a
 *    short XLS-89 object (<= 1024 bytes) carrying the sha256 of the full lot specification, which stays off ledger.
 *
 * Learned on Testnet (Nov 2026): an MPT issuance with DomainID was refused (temDISABLED: the amendment was not enabled there), so the
 * receipt uses plan B: the issuer authorizes each holder one by one, AFTER checking on ledger that the holder is a domain member. In
 * both plans the lock is the ledger's (RequireAuth): an unauthorized account receiving the MPT fails with tecNO_AUTH.
 *
 * This is a DEMONSTRATION pattern. A token receipt for a real lot is a legal question in each jurisdiction (warehouse receipt,
 * title, securities law); this module does not make it one.
 */
import { canonicalJson, sha256Hex } from "../oracle/index.js";
import { LSF_ACCEPTED, RIPPLE_EPOCH } from "../mandate/index.js";

const hexAscii = (s) => Buffer.from(String(s), "ascii").toString("hex").toUpperCase();
const asciiHex = (h) => Buffer.from(String(h), "hex").toString("ascii");
const TYPE = /^[A-Z][A-Z0-9_]{1,63}$/;

/* ---------- verified domain ---------- */

/** credential expiration (Ripple epoch): end of `today` (UTC) + days, capped by maxDays */
export function credentialExpiration(today, days, maxDays = 90) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(today))) throw new Error("today must be YYYY-MM-DD");
  if (!Number.isInteger(days) || days < 1 || days > maxDays) throw new Error(`days must be an integer 1..${maxDays}`);
  return Date.parse(`${today}T23:59:59Z`) / 1000 + days * 86400 - RIPPLE_EPOCH;
}

export function buildCredentialCreate(issuer, subject, type, expiration) {
  if (!TYPE.test(type)) throw new Error("credential type: UPPER_SNAKE, 2 to 64 chars");
  if (!Number.isInteger(expiration)) throw new Error("expiration (Ripple epoch seconds) is required");
  return { TransactionType: "CredentialCreate", Account: issuer, Subject: subject, CredentialType: hexAscii(type), Expiration: expiration };
}
export const buildCredentialAccept = (subject, issuer, type) => ({ TransactionType: "CredentialAccept", Account: subject, Issuer: issuer, CredentialType: hexAscii(type) });

/** PermissionedDomainSet accepting the given credentials ([{issuer, type}]); with domainId, updates that domain */
export function buildDomainSet(owner, accepted, domainId) {
  if (!Array.isArray(accepted) || !accepted.length || accepted.length > 10) throw new Error("accepted: 1 to 10 credentials");
  const tx = { TransactionType: "PermissionedDomainSet", Account: owner, AcceptedCredentials: accepted.map(({ issuer, type }) => ({ Credential: { Issuer: issuer, CredentialType: hexAscii(type) } })) };
  if (domainId) tx.DomainID = domainId;
  return tx;
}

/** PermissionedDomain ledger object -> {id, owner, accepted: [{issuer, type}]} */
export function domainFromLedger(node) {
  if (!node || node.LedgerEntryType !== "PermissionedDomain") return null;
  return { id: node.index, owner: node.Owner, accepted: (node.AcceptedCredentials ?? []).map((c) => ({ issuer: c.Credential.Issuer, type: asciiHex(c.Credential.CredentialType) })) };
}

/** member = the Credential ledger object is accepted, not expired at nowUnix, and of an issuer/type the domain accepts */
export function isMember(domain, credentialNode, nowUnix) {
  if (!domain || !credentialNode || credentialNode.LedgerEntryType !== "Credential") return false;
  if ((Number(credentialNode.Flags) & LSF_ACCEPTED) === 0) return false;
  if (Number.isInteger(credentialNode.Expiration) && credentialNode.Expiration + RIPPLE_EPOCH < nowUnix) return false;
  const type = asciiHex(credentialNode.CredentialType);
  return domain.accepted.some((a) => a.issuer === credentialNode.Issuer && a.type === type);
}

/* ---------- lot receipt (MPT) ---------- */

export const MPT_FLAGS = Object.freeze({ tfMPTRequireAuth: 4, tfMPTCanEscrow: 8, tfMPTCanTransfer: 32 });
export const METADATA_MAX_BYTES = 1024;
const BANNED = /price|pre[cç]o|r\$|us\$|\$\s?\d|cpf|cnpj|passport|latitude|longitude|farm name|owner name/i;

/** sha256 of the canonical JSON of the full lot specification (kept off ledger; the hash proves it) */
export const lotSpecHash = (spec) => sha256Hex(canonicalJson(spec));

/**
 * Short XLS-89 metadata (hex) for the receipt. `spec` = { demonstration: true, lot_id, season, unit, bags, region, ...more };
 * only lot_id, season, unit, bags, region and the spec hash go on ledger. Refuses prices and personal data.
 */
export function receiptMetadata(spec, issuerName = "EXAMPLE ISSUER (test)") {
  if (spec?.demonstration !== true) throw new Error("the lot must be marked demonstration: true");
  if (!Number.isInteger(spec.bags) || spec.bags <= 0) throw new Error("bags must be a positive integer");
  const meta = {
    t: "DLOT",
    n: "DEMONSTRATION fictitious lot",
    d: "DEMONSTRATION on testnet: fictitious lot, no value, no real producer",
    ac: "rwa",
    as: "commodity",
    in: issuerName,
    ai: { lot: spec.lot_id, season: spec.season, unit: spec.unit, bags: spec.bags, region: spec.region, sha256_spec: lotSpecHash(spec) },
  };
  const text = JSON.stringify(meta);
  if (BANNED.test(text)) throw new Error("metadata with a price or personal data: refused");
  const h = Buffer.from(text, "utf8").toString("hex").toUpperCase();
  if (h.length / 2 > METADATA_MAX_BYTES) throw new Error(`metadata is ${h.length / 2} bytes, above ${METADATA_MAX_BYTES}`);
  return h;
}
export const decodeReceiptMetadata = (h) => JSON.parse(Buffer.from(h, "hex").toString("utf8"));

/** MPTokenIssuanceCreate for the receipt (plan B by default; pass domainId only where the ledger enables it) */
export function buildReceiptIssuance(issuer, spec, { domainId, issuerName } = {}) {
  const tx = {
    TransactionType: "MPTokenIssuanceCreate",
    Account: issuer,
    AssetScale: 0,
    MaximumAmount: String(spec.bags),
    Flags: MPT_FLAGS.tfMPTRequireAuth | MPT_FLAGS.tfMPTCanTransfer | MPT_FLAGS.tfMPTCanEscrow,
    MPTokenMetadata: receiptMetadata(spec, issuerName),
  };
  if (domainId) tx.DomainID = domainId;
  return tx;
}
/** the holder opts in */
export const buildOptIn = (holder, issuanceId) => ({ TransactionType: "MPTokenAuthorize", Account: holder, MPTokenIssuanceID: issuanceId });
/** plan B: the issuer authorizes a holder; call only after isMember(...) is true for that holder */
export function buildIssuerAuthorize(issuer, holder, issuanceId, memberChecked) {
  if (memberChecked !== true) throw new Error("check domain membership on ledger before authorizing a holder");
  return { TransactionType: "MPTokenAuthorize", Account: issuer, Holder: holder, MPTokenIssuanceID: issuanceId };
}
/** the issuer delivers bags of the receipt to an authorized holder */
export const buildDelivery = (issuer, holder, issuanceId, bags) => {
  if (!Number.isInteger(bags) || bags <= 0) throw new Error("bags must be a positive integer");
  return { TransactionType: "Payment", Account: issuer, Destination: holder, Amount: { mpt_issuance_id: issuanceId, value: String(bags) } };
};
