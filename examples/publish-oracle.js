// SPDX-License-Identifier: Apache-2.0
// Publishes an agro class record to an XRPL oracle on Testnet. Your seed comes from the KIT_XRPL_SEED environment variable and is
// never printed. Without --send it only builds and autofills the transaction.
// Usage: KIT_XRPL_SEED=... node examples/publish-oracle.js examples/enso-record.json [--send]
import fs from "node:fs";
import { Client, Wallet } from "xrpl";
import { buildOracleSet, readOracle, verifyOracle } from "../src/oracle/index.js";
import { exampleNetwork } from "./testnet.js";

const [file] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const send = process.argv.includes("--send");
const record = JSON.parse(fs.readFileSync(file ?? "examples/enso-record.json", "utf8"));
const pairs = Object.entries(record.values).map(([k, v]) => ({ base: `${record.indicator}_${k.toUpperCase()}`.slice(0, 20), value: v }));
const seed = process.env.KIT_XRPL_SEED;
if (!seed) throw new Error("set KIT_XRPL_SEED (a Testnet seed; get one at the official faucet)");
const wallet = Wallet.fromSeed(seed);
const client = new Client(exampleNetwork());
await client.connect();
try {
  const tx = await client.autofill(buildOracleSet({ account: wallet.classicAddress, documentId: 1, provider: "MY_PUBLISHER", assetClass: "agro", record, pairs, lastUpdateTime: Math.floor(Date.now() / 1000) }));
  console.log("prepared (unsigned):", JSON.stringify(tx));
  if (!send) { console.log("dry run: nothing signed or sent (add --send)"); process.exit(0); }
  const res = await client.submitAndWait(wallet.sign(tx).tx_blob);
  console.log(`result ${res.result.meta?.TransactionResult}; hash ${res.result.hash}`);
  const check = verifyOracle(await readOracle(client, wallet.classicAddress, 1), record, pairs);
  console.log(check.ok ? "read back: matches the record" : `read back: MISMATCH ${check.problems.join("; ")}`);
} finally {
  await client.disconnect();
}
