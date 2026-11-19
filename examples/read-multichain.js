// SPDX-License-Identifier: Apache-2.0
// Reads the same class record on Stellar Testnet and XDC Apothem (read-only, no keys) and, with a record file, verifies the hash.
// Usage: node examples/read-multichain.js <stellarAccount> <stellarTxHash> <xdcContract> <INDICATOR> <NAME1,NAME2> [record.json]
// Example (AETERNUM testnet publications of 17-18 Nov 2026):
//   node examples/read-multichain.js GABV43A5IUUNNYW6RX7N7KDA7K5UBBHBWAB3RDMSENCRAJ7AXH5ZQUS5 \
//     2d2343816732db250ef55ea42e64a1d342d53276781a01d705dabfccd9125103 0x816919326C8f51E9BE93df4De4D023689368a26b ENSO_FASE ENSO_FASE,ENSO_INT
import fs from "node:fs";
import { readStellar, readXdc, verifyAcrossLedgers } from "../src/multichain/index.js";
import { STELLAR_TESTNET, XDC_APOTHEM } from "./testnet.js";

const [account, txHash, contract, indicator, names, file] = process.argv.slice(2);
if (!names) throw new Error("usage: read-multichain.js <stellarAccount> <stellarTxHash> <xdcContract> <INDICATOR> <NAME1,NAME2> [record.json]");
const stellar = await readStellar(STELLAR_TESTNET, account, names.split(","), txHash);
const xdc = await readXdc(XDC_APOTHEM.rpc, contract, indicator);
console.log(JSON.stringify({ stellar, xdc }, null, 1));
if (file) {
  const record = JSON.parse(fs.readFileSync(file, "utf8"));
  const r = verifyAcrossLedgers(record, { stellar: { classes: stellar.classes, memoHash: stellar.memoHash }, xdc: { record: xdc } });
  console.log(r.ok ? `verified: Stellar memo hash = sha256 of the record (${r.hash})` : `NOT verified: ${r.problems.join("; ")}`);
  for (const n of r.notes) console.log(`note: ${n}`);
}
