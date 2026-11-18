// SPDX-License-Identifier: Apache-2.0
// Reads any account's oracle on Testnet (read-only, no keys) and, if a record file is given, verifies the URI hash and values.
// Usage: node examples/read-oracle.js <account> <documentId> [record.json]
import fs from "node:fs";
import { Client } from "xrpl";
import { readOracle, verifyOracle } from "../src/oracle/index.js";
import { exampleNetwork } from "./testnet.js";

const [account, doc, file] = process.argv.slice(2);
const client = new Client(exampleNetwork());
await client.connect();
try {
  const o = await readOracle(client, account, Number(doc ?? 1));
  console.log(JSON.stringify(o, null, 1));
  if (file) {
    const record = JSON.parse(fs.readFileSync(file, "utf8"));
    const pairs = Object.entries(record.values).map(([k, v]) => ({ base: `${record.indicator}_${k.toUpperCase()}`.slice(0, 20), value: v }));
    const r = verifyOracle(o, record, pairs);
    console.log(r.ok ? "verified: hash and values match" : `NOT verified: ${r.problems.join("; ")}`);
  }
} finally {
  await client.disconnect();
}
