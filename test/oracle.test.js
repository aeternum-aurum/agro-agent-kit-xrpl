// SPDX-License-Identifier: Apache-2.0
// Module 1 tests: no network, no keys (a throwaway wallet is generated in memory to prove xrpl.js accepts what we build).
import { test } from "node:test";
import assert from "node:assert/strict";
import { Wallet, decode } from "xrpl";
import { buildOracleSet, currencyCode, decodeOracle, decodePrice, encodeClass, recordHash, validateRecord, verifyOracle } from "../src/oracle/index.js";

const record = { indicator: "ENSO_PHASE", reference: "2026-ASO", values: { phase: 1, intensity: 4 }, source: "NOAA/CPC ONI (public), classes derived by the publisher", issued_at: "2026-11-16T19:40:00-03:00" };
const pairs = [{ base: "ENSO_PHASE", value: 1 }, { base: "ENSO_INTENSITY", value: 4 }];
const w = Wallet.generate();
const tx = () => buildOracleSet({ account: w.classicAddress, documentId: 1, provider: "EXAMPLE", assetClass: "agro", record, pairs, lastUpdateTime: 1794921741 });

test("currency codes: 3 chars stay, longer ones become 40 hex, XRP refused", () => {
  assert.equal(currencyCode("CLS"), "CLS");
  assert.equal(currencyCode("ENSO_PHASE").length, 40);
  assert.throws(() => currencyCode("XRP"));
  assert.throws(() => currencyCode("THIS_NAME_IS_WAY_TOO_LONG"));
});

test("a class is encoded as value x 10 with Scale 1 and decodes back", () => {
  assert.deepEqual(encodeClass(4), { AssetPrice: "28", Scale: 1 });
  assert.equal(decodePrice("28", 1), 4);
  assert.throws(() => encodeClass(2.5));
  assert.throws(() => encodeClass(300));
});

test("records must carry classes, not prices", () => {
  assert.deepEqual(validateRecord(record), []);
  assert.ok(validateRecord({ ...record, values: { price: 123.45 } }).length > 0);
  assert.ok(validateRecord({ ...record, source: "" }).length > 0);
});

test("OracleSet carries the record hash in the URI and every pair", () => {
  const t = tx();
  assert.equal(Buffer.from(t.URI, "hex").toString(), `sha256:${recordHash(record)}`);
  assert.equal(t.PriceDataSeries.length, 2);
  assert.ok(t.AssetClass.length <= 16);
});

test("xrpl.js 5.3.0 signs the transaction (throwaway wallet, no network)", () => {
  const signed = w.sign({ ...tx(), Fee: "12", Sequence: 1, LastLedgerSequence: 10, Flags: 0 });
  assert.equal(decode(signed.tx_blob).TransactionType, "OracleSet");
});

test("removing a pair sends it without AssetPrice and Scale, and still signs", () => {
  const t = buildOracleSet({ account: w.classicAddress, documentId: 1, provider: "EXAMPLE", assetClass: "agro", record, pairs, lastUpdateTime: 1794921741, removePairs: ["OLD_PAIR", "ENSO_PHASE"] });
  assert.equal(t.PriceDataSeries.length, 3);
  assert.equal(t.PriceDataSeries[2].PriceData.AssetPrice, undefined);
  assert.doesNotThrow(() => w.sign({ ...t, Fee: "12", Sequence: 1, LastLedgerSequence: 10, Flags: 0 }));
});

test("verification passes on a faithful oracle and catches a tampered value or hash", () => {
  const t = tx();
  const node = { Owner: w.classicAddress, Provider: t.Provider, AssetClass: t.AssetClass, URI: t.URI, LastUpdateTime: t.LastUpdateTime, PriceDataSeries: t.PriceDataSeries };
  assert.equal(verifyOracle(decodeOracle(node), record, pairs).ok, true);
  const tampered = structuredClone(node); tampered.PriceDataSeries[0].PriceData.AssetPrice = "14";
  assert.equal(verifyOracle(decodeOracle(tampered), record, pairs).ok, false);
  assert.equal(verifyOracle(decodeOracle(node), { ...record, reference: "2026-SON" }, pairs).ok, false);
});
