// SPDX-License-Identifier: Apache-2.0
// Module 5 tests: no network, no keys. Fixtures are the real answers read from Stellar Testnet and XDC Apothem on 19 Nov 2026.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bytes32Name, decodeStellarClasses, decodeStellarMemoHash, decodeXdcRecord, stellarAccountUrl, stellarTxUrl, verifyAcrossLedgers, xdcReadRequest } from "../src/multichain/index.js";
import { recordHash } from "../src/oracle/index.js";

const record = { indicator: "ENSO_PHASE", reference: "2026-ASO", values: { phase: 1, intensity: 4 }, source: "NOAA/CPC ONI (public), classes derived by the publisher", issued_at: "2026-11-16T19:40:00-03:00" };
const H = recordHash(record);
const words = (...w) => `0x${w.join("")}`;
const n = (v) => v.toString(16).padStart(64, "0");
const SRC = "118c563331335c8649cdc2677e6be7ae89d1259d901345fcddbc2857af280f7f";

test("Stellar: URLs only for well-formed account and transaction hash", () => {
  assert.equal(stellarAccountUrl("https://horizon-testnet.stellar.org/", "GABV43A5IUUNNYW6RX7N7KDA7K5UBBHBWAB3RDMSENCRAJ7AXH5ZQUS5"), "https://horizon-testnet.stellar.org/accounts/GABV43A5IUUNNYW6RX7N7KDA7K5UBBHBWAB3RDMSENCRAJ7AXH5ZQUS5");
  assert.throws(() => stellarAccountUrl("https://h", "rNotStellar"));
  assert.throws(() => stellarTxUrl("https://h", "ABC"));
});

test("Stellar: 1-byte data entries decode to classes; missing is null; longer values are refused", () => {
  const acc = { data: { ENSO_FASE: "AQ==", ENSO_INT: "BA==", BIG: "AQI=" } };
  assert.deepEqual(decodeStellarClasses(acc, ["ENSO_FASE", "ENSO_INT", "NONE"]), { ENSO_FASE: 1, ENSO_INT: 4, NONE: null });
  assert.throws(() => decodeStellarClasses(acc, ["BIG"]));
});

test("Stellar: memo of type hash decodes to hex; other memos give null", () => {
  assert.equal(decodeStellarMemoHash({ memo_type: "hash", memo: Buffer.from(H, "hex").toString("base64") }), H);
  assert.equal(decodeStellarMemoHash({ memo_type: "text", memo: "hello" }), null);
});

test("XDC: eth_call body with the registros(bytes32) selector and the right-padded name", () => {
  assert.equal(bytes32Name("ENSO_FASE"), "454e534f5f464153450000000000000000000000000000000000000000000000");
  const body = xdcReadRequest("0x816919326C8f51E9BE93df4De4D023689368a26b", "ENSO_FASE");
  assert.equal(body.method, "eth_call");
  assert.equal(body.params[0].data, "0x762849cc454e534f5f464153450000000000000000000000000000000000000000000000");
  assert.throws(() => xdcReadRequest("0x123", "ENSO_FASE"));
  assert.throws(() => bytes32Name("X".repeat(32)));
});

test("XDC: 6-word answer (real Apothem read) and 7-word answer with the record hash", () => {
  const six = words(n(1), n(4), n(202608), n(1794868800), SRC, n(0));
  assert.deepEqual(decodeXdcRecord(six), { phase: 1, intensity: 4, reference: 202608, issuedAt: 1794868800, sourceHash: `0x${SRC}`, example: false });
  assert.equal(decodeXdcRecord(words(n(1), n(4), n(202608), n(1794868800), SRC, n(0), H)).recordHash, `0x${H}`);
  assert.throws(() => decodeXdcRecord("0x00"));
});

test("one record, three ledgers: all agree; any mismatch is named", () => {
  const xdc = decodeXdcRecord(words(n(1), n(4), n(202608), n(1794868800), SRC, n(0), H));
  const read = { xrplUriHash: H, stellar: { classes: { ENSO_FASE: 1, ENSO_INT: 4 }, memoHash: H, expected: { ENSO_FASE: 1, ENSO_INT: 4 } }, xdc: { record: xdc, expected: { phase: 1, intensity: 4 } } };
  assert.deepEqual(verifyAcrossLedgers(record, read), { ok: true, hash: H, problems: [], notes: [] });
  const old = decodeXdcRecord(words(n(1), n(4), n(202608), n(1794868800), SRC, n(0)));
  assert.deepEqual(verifyAcrossLedgers(record, { xdc: { record: old, expected: { phase: 1 } } }).notes, ["XDC: no record hash in this contract; checked on the classes only"]);
  const bad = verifyAcrossLedgers(record, { ...read, stellar: { ...read.stellar, memoHash: "0".repeat(64) }, xdc: { ...read.xdc, expected: { phase: 2 } } });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.problems, ["Stellar: memo hash differs from the record", "XDC: phase is 1, expected 2"]);
});
