// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 AETERNUM AURUM PARTNERS
/**
 * Module 5 — Read the same class record on Stellar and XDC (read-only, no keys, no extra dependency).
 *
 * The class oracle of Module 1 can be mirrored on other ledgers with the SAME record hash, so a reader can check one file
 * against three independent networks. This module only READS: it builds the HTTP / JSON-RPC requests, decodes the answers and
 * verifies them against a record file. Transport is the global fetch (Node >= 20).
 *
 *  - Stellar: each class is an account data entry (manage_data) of 1 byte; the publishing transaction carries a memo of type
 *    "hash" = sha256 of the canonical record (the same hash as the XRPL oracle URI).
 *  - XDC (EVM): a minimal contract with `registros(bytes32) -> (uint8 phase, uint8 intensity, uint32 reference, uint32 issuedAt,
 *    bytes32 sourceHash, bool example[, bytes32 recordHash])`; the optional last word carries the same record hash.
 *    Read through eth_call; the selector 0x762849cc = keccak256("registros(bytes32)")[0..4].
 */
import { recordHash } from "../oracle/index.js";

/* ---------- Stellar (Horizon REST) ---------- */

/** GET URL of an account on a Horizon server */
export const stellarAccountUrl = (horizon, account) => {
  if (!/^G[A-Z2-7]{55}$/.test(String(account))) throw new Error("Stellar account must be a G... public key (56 chars)");
  return `${String(horizon).replace(/\/$/, "")}/accounts/${account}`;
};
/** GET URL of a transaction on a Horizon server */
export const stellarTxUrl = (horizon, txHash) => {
  if (!/^[0-9a-f]{64}$/.test(String(txHash))) throw new Error("Stellar transaction hash: 64 lowercase hex chars");
  return `${String(horizon).replace(/\/$/, "")}/transactions/${txHash}`;
};

/** account JSON (Horizon) -> { NAME: class } for the given data entry names; missing entries are null */
export function decodeStellarClasses(accountJson, names) {
  const data = accountJson?.data ?? accountJson?.data_attr ?? {};
  return Object.fromEntries(names.map((n) => {
    if (!(n in data)) return [n, null];
    const b = Buffer.from(data[n], "base64");
    if (b.length !== 1) throw new Error(`data entry ${n} is not a 1-byte class`);
    return [n, b[0]];
  }));
}

/** transaction JSON (Horizon) -> the memo hash in hex, or null if the memo is not of type "hash" */
export function decodeStellarMemoHash(txJson) {
  if (txJson?.memo_type !== "hash" || !txJson.memo) return null;
  return Buffer.from(txJson.memo, "base64").toString("hex");
}

/* ---------- XDC / EVM (JSON-RPC eth_call) ---------- */

export const REGISTROS_SELECTOR = "0x762849cc";

/** ASCII name -> bytes32 hex (right-padded), like ethers.encodeBytes32String */
export function bytes32Name(name) {
  const b = Buffer.from(String(name), "utf8");
  if (b.length > 31) throw new Error("name longer than 31 bytes");
  return b.toString("hex").padEnd(64, "0");
}

/** JSON-RPC body for eth_call registros(bytes32) on the contract (latest block) */
export function xdcReadRequest(contract, indicator, id = 1) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(String(contract))) throw new Error("contract must be a 0x address (40 hex chars)");
  return { jsonrpc: "2.0", id, method: "eth_call", params: [{ to: contract, data: `${REGISTROS_SELECTOR}${bytes32Name(indicator)}` }, "latest"] };
}

/** eth_call result (0x + 6 or 7 words) -> the decoded record; recordHash only when the 7th word exists */
export function decodeXdcRecord(resultHex) {
  const h = String(resultHex).replace(/^0x/, "");
  if (h.length % 64 !== 0 || (h.length !== 6 * 64 && h.length !== 7 * 64)) throw new Error(`unexpected eth_call result: ${h.length / 64} words`);
  const w = (i) => h.slice(i * 64, (i + 1) * 64);
  const out = {
    phase: parseInt(w(0), 16),
    intensity: parseInt(w(1), 16),
    reference: parseInt(w(2), 16),
    issuedAt: parseInt(w(3), 16),
    sourceHash: `0x${w(4)}`,
    example: BigInt(`0x${w(5)}`) === 1n,
  };
  if (h.length === 7 * 64) out.recordHash = `0x${w(6)}`;
  return out;
}

/* ---------- one record, three ledgers ---------- */

/**
 * Verifies what was read on each ledger against a record file. Each entry is optional:
 *  { xrplUriHash?: hex, stellar?: { classes: {NAME: n}, memoHash: hex, expected: {NAME: n} }, xdc?: { record: decoded, expected: {phase, intensity} } }
 * Returns { ok, hash, problems, notes }. A contract without the record-hash field (6 words) is checked on the classes only,
 * and `notes` says so.
 */
export function verifyAcrossLedgers(record, read) {
  const hash = recordHash(record);
  const problems = [];
  const notes = [];
  if (read.xrplUriHash !== undefined && read.xrplUriHash !== hash) problems.push("XRPL: URI hash differs from the record");
  if (read.stellar) {
    if (read.stellar.memoHash !== hash) problems.push("Stellar: memo hash differs from the record");
    for (const [k, v] of Object.entries(read.stellar.expected ?? {})) if (read.stellar.classes?.[k] !== v) problems.push(`Stellar: ${k} is ${read.stellar.classes?.[k]}, expected ${v}`);
  }
  if (read.xdc) {
    const r = read.xdc.record;
    for (const [k, v] of Object.entries(read.xdc.expected ?? {})) if (r?.[k] !== v) problems.push(`XDC: ${k} is ${r?.[k]}, expected ${v}`);
    if (r?.recordHash === undefined) notes.push("XDC: no record hash in this contract; checked on the classes only");
    else if (r.recordHash !== `0x${hash}`) problems.push("XDC: recordHash differs from the record");
  }
  return { ok: problems.length === 0, hash, problems, notes };
}

/** convenience readers (network calls through fetch; pass a testnet URL) */
export async function readStellar(horizon, account, names, txHash) {
  const acc = await (await fetch(stellarAccountUrl(horizon, account))).json();
  const out = { classes: decodeStellarClasses(acc, names) };
  if (txHash) out.memoHash = decodeStellarMemoHash(await (await fetch(stellarTxUrl(horizon, txHash))).json());
  return out;
}
export async function readXdc(rpc, contract, indicator) {
  const r = await (await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(xdcReadRequest(contract, indicator)) })).json();
  if (r.error) throw new Error(`eth_call failed: ${r.error.message}`);
  return decodeXdcRecord(r.result);
}
