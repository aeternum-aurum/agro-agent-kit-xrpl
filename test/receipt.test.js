// SPDX-License-Identifier: Apache-2.0
// Module 6 tests: no network, no keys (throwaway wallets in memory prove xrpl.js 5.3.0 accepts and signs what we build).
import { test } from "node:test";
import assert from "node:assert/strict";
import { Wallet, decode } from "xrpl";
import { MPT_FLAGS, buildCredentialAccept, buildCredentialCreate, buildDelivery, buildDomainSet, buildIssuerAuthorize, buildOptIn, buildReceiptIssuance, credentialExpiration, decodeReceiptMetadata, domainFromLedger, isMember, lotSpecHash, receiptMetadata } from "../src/receipt/index.js";
import { RIPPLE_EPOCH } from "../src/mandate/index.js";

const issuer = Wallet.generate(), member = Wallet.generate(), outsider = Wallet.generate();
const signs = (w, tx) => decode(w.sign({ ...tx, Fee: "12", Sequence: 1, LastLedgerSequence: 10, Flags: tx.Flags ?? 0 }).tx_blob);
const spec = { demonstration: true, lot_id: "DEMO-LOT-001", season: "2026/27", unit: "bag 60 kg", bags: 100, region: "BR-MG", notes: "full specification stays off ledger" };
const ISS = "0155C5628E8D97E0F327925A8F04BA8C90EB1FBB4E226262";

test("credential: create (with expiration) and accept are signed; expiration is capped", () => {
  const exp = credentialExpiration("2026-11-19", 30);
  assert.equal(exp + RIPPLE_EPOCH, Date.parse("2026-11-19T23:59:59Z") / 1000 + 30 * 86400);
  assert.throws(() => credentialExpiration("2026-11-19", 91));
  assert.equal(signs(issuer, buildCredentialCreate(issuer.classicAddress, member.classicAddress, "MEMBER", exp)).TransactionType, "CredentialCreate");
  assert.equal(signs(member, buildCredentialAccept(member.classicAddress, issuer.classicAddress, "MEMBER")).CredentialType, Buffer.from("MEMBER").toString("hex").toUpperCase());
  assert.throws(() => buildCredentialCreate(issuer.classicAddress, member.classicAddress, "member", exp));
});

test("domain: PermissionedDomainSet signs; the ledger object decodes; membership needs accepted, unexpired, accepted type", () => {
  assert.equal(signs(issuer, buildDomainSet(issuer.classicAddress, [{ issuer: issuer.classicAddress, type: "MEMBER" }])).TransactionType, "PermissionedDomainSet");
  const hex = Buffer.from("MEMBER").toString("hex").toUpperCase();
  const dom = domainFromLedger({ LedgerEntryType: "PermissionedDomain", index: "AB", Owner: issuer.classicAddress, AcceptedCredentials: [{ Credential: { Issuer: issuer.classicAddress, CredentialType: hex } }] });
  assert.deepEqual(dom.accepted, [{ issuer: issuer.classicAddress, type: "MEMBER" }]);
  const now = Date.parse("2026-11-19T12:00:00Z") / 1000;
  const cred = { LedgerEntryType: "Credential", Issuer: issuer.classicAddress, CredentialType: hex, Flags: 0x00010000, Expiration: credentialExpiration("2026-11-19", 30) };
  assert.equal(isMember(dom, cred, now), true);
  assert.equal(isMember(dom, { ...cred, Flags: 0 }, now), false, "not accepted");
  assert.equal(isMember(dom, { ...cred, Expiration: 100 }, now), false, "expired");
  assert.equal(isMember(dom, { ...cred, Issuer: outsider.classicAddress }, now), false, "other issuer");
  assert.equal(isMember(dom, { ...cred, CredentialType: Buffer.from("OTHER").toString("hex") }, now), false, "other type");
});

test("receipt metadata: short XLS-89 with the spec hash; demonstration only; no prices or personal data", () => {
  const m = decodeReceiptMetadata(receiptMetadata(spec));
  assert.equal(m.ai.sha256_spec, lotSpecHash(spec));
  assert.equal(m.ai.bags, 100);
  assert.equal("notes" in m.ai, false, "the full spec stays off ledger");
  assert.throws(() => receiptMetadata({ ...spec, demonstration: false }));
  assert.throws(() => receiptMetadata({ ...spec, region: "price 1200" }));
  assert.throws(() => receiptMetadata({ ...spec, lot_id: "CPF 123" }));
});

test("receipt issuance: RequireAuth + CanTransfer + CanEscrow, scale 0, max = bags; signs", () => {
  const tx = buildReceiptIssuance(issuer.classicAddress, spec);
  assert.equal(tx.Flags, MPT_FLAGS.tfMPTRequireAuth | MPT_FLAGS.tfMPTCanTransfer | MPT_FLAGS.tfMPTCanEscrow);
  assert.deepEqual([tx.AssetScale, tx.MaximumAmount, "DomainID" in tx], [0, "100", false]);
  assert.equal(signs(issuer, tx).TransactionType, "MPTokenIssuanceCreate");
});

test("plan B: opt-in, issuer authorization only after the membership check, delivery; all sign", () => {
  assert.equal(signs(member, buildOptIn(member.classicAddress, ISS)).TransactionType, "MPTokenAuthorize");
  assert.throws(() => buildIssuerAuthorize(issuer.classicAddress, member.classicAddress, ISS, false));
  assert.equal(signs(issuer, buildIssuerAuthorize(issuer.classicAddress, member.classicAddress, ISS, true)).Holder, member.classicAddress);
  assert.deepEqual(signs(issuer, buildDelivery(issuer.classicAddress, member.classicAddress, ISS, 100)).Amount, { mpt_issuance_id: ISS, value: "100" });
  assert.throws(() => buildDelivery(issuer.classicAddress, member.classicAddress, ISS, 0));
});
