// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 AETERNUM AURUM PARTNERS
/**
 * Module 1 — Agro class oracle on the XRP Ledger (XLS-47 PriceOracle / OracleSet).
 *
 * Publishes small integer CLASSES of agro indicators (e.g. ENSO phase, rainfall-vs-normal class) — never prices — with a
 * provenance hash of the source record in the oracle URI, so anyone can verify the on-ledger value against a published file.
 *
 * Field rules learned on Testnet (xrpl.js 5.3.0, Nov 2026):
 *  - AssetClass: at most 16 hex chars (8 ASCII letters). Provider and URI: at most 256 hex chars.
 *  - LastUpdateTime: Unix seconds (not Ripple epoch), within 300 s of the ledger close.
 *  - xrpl.js refuses an explicit Scale of 0 (the default) and requires Scale whenever AssetPrice is present, so a class is
 *    encoded as AssetPrice = class × 10 with Scale = 1 (value read = AssetPrice × 10^-Scale = class).
 *  - A pair left out of an update loses its price: always resend every pair; to delete a pair, send it without AssetPrice/Scale.
 *  - Base/quote codes longer than 3 chars become 160-bit non-standard currency codes (40 hex chars).
 */
import crypto from "node:crypto";

const hexAscii = (s) => Buffer.from(String(s), "ascii").toString("hex").toUpperCase();
const asciiHex = (h) => Buffer.from(String(h), "hex").toString("ascii").replace(/\0+$/, "");

/** XRPL currency code: 3 chars stay as is; longer names (up to 20 ASCII chars) become the 40-hex non-standard code */
export function currencyCode(name) {
  const s = String(name);
  if (!/^[\x20-\x7E]{3,20}$/.test(s)) throw new Error(`currency code must be 3 to 20 printable ASCII chars: ${s}`);
  if (s.length === 3) {
    if (s === "XRP") throw new Error("XRP is not allowed as an oracle asset code");
    return s;
  }
  return hexAscii(s).padEnd(40, "0");
}
export const decodeCurrency = (code) => (code.length === 40 ? asciiHex(code) : code);

/** canonical JSON (sorted keys, no spaces): the same record always gives the same hash */
export function canonicalJson(v) {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(",")}}`;
  return JSON.stringify(v);
}
export const sha256Hex = (data) => crypto.createHash("sha256").update(data).digest("hex");
export const recordHash = (record) => sha256Hex(canonicalJson(record));

/** a class (integer 0..255) as AssetPrice/Scale; see the Scale note above */
export function encodeClass(value) {
  if (!Number.isInteger(value) || value < 0 || value > 255) throw new Error(`class must be an integer 0..255: ${value}`);
  return { AssetPrice: (value * 10).toString(16).toUpperCase(), Scale: 1 };
}
/** AssetPrice (hex string or number) and Scale back to a number */
export function decodePrice(assetPrice, scale = 0) {
  const raw = typeof assetPrice === "string" ? parseInt(assetPrice, 16) : Number(assetPrice);
  return raw / 10 ** Number(scale ?? 0);
}

/**
 * Validates a generic class record: { indicator, reference, values: {name: int}, source, issued_at, example?: bool, ...extra }.
 * Values must be small integers (classes). Returns a list of problems (empty = valid).
 */
export function validateRecord(r) {
  const p = [];
  if (!/^[A-Z][A-Z0-9_]{1,30}$/.test(String(r?.indicator ?? ""))) p.push("indicator: UPPER_SNAKE name, 2 to 31 chars");
  if (!r?.reference) p.push("reference is required (period or place code)");
  if (!r?.values || typeof r.values !== "object" || !Object.keys(r.values).length) p.push("values: at least one class");
  for (const [k, v] of Object.entries(r?.values ?? {})) if (!Number.isInteger(v) || v < 0 || v > 255) p.push(`values.${k} must be an integer 0..255 (a class, not a price)`);
  if (!r?.source) p.push("source is required");
  if (Number.isNaN(Date.parse(r?.issued_at))) p.push("issued_at must be an ISO date-time");
  return p;
}

/**
 * Builds an OracleSet transaction (unsigned, not autofilled).
 * @param {{account: string, documentId: number, provider: string, assetClass: string, quote?: string,
 *          record: object, pairs: {base: string, value: number}[], lastUpdateTime: number, removePairs?: string[]}} o
 */
export function buildOracleSet(o) {
  const problems = validateRecord(o.record);
  if (problems.length) throw new Error(`invalid record: ${problems.join("; ")}`);
  if (!Number.isInteger(o.documentId) || o.documentId < 0) throw new Error("documentId must be a non-negative integer");
  if (!Number.isInteger(o.lastUpdateTime) || o.lastUpdateTime < 1e9) throw new Error("lastUpdateTime must be Unix seconds");
  const quote = currencyCode(o.quote ?? "CLS");
  const series = o.pairs.map(({ base, value }) => ({ PriceData: { BaseAsset: currencyCode(base), QuoteAsset: quote, ...encodeClass(value) } }));
  const present = new Set(series.map((s) => s.PriceData.BaseAsset));
  for (const name of o.removePairs ?? []) {
    const code = /^[0-9A-F]{40}$/.test(name) ? name : currencyCode(name);
    if (!present.has(code)) series.push({ PriceData: { BaseAsset: code, QuoteAsset: quote } });
  }
  if (series.length < 1 || series.length > 10) throw new Error("an oracle holds 1 to 10 pairs (more than 5 costs two owner reserves)");
  const tx = {
    TransactionType: "OracleSet",
    Account: o.account,
    OracleDocumentID: o.documentId,
    Provider: hexAscii(o.provider),
    AssetClass: hexAscii(o.assetClass),
    URI: hexAscii(`sha256:${recordHash(o.record)}`),
    LastUpdateTime: o.lastUpdateTime,
    PriceDataSeries: series,
  };
  if (tx.AssetClass.length > 16) throw new Error("assetClass: at most 8 ASCII chars (16 hex)");
  if (tx.Provider.length > 256 || tx.URI.length > 256) throw new Error("provider/URI: at most 256 hex chars");
  return tx;
}

/** decodes an Oracle ledger object into plain JS */
export function decodeOracle(node) {
  return {
    owner: node.Owner,
    provider: asciiHex(node.Provider ?? ""),
    assetClass: asciiHex(node.AssetClass ?? ""),
    uri: asciiHex(node.URI ?? ""),
    lastUpdateTime: node.LastUpdateTime,
    pairs: (node.PriceDataSeries ?? []).map((p) => ({
      base: decodeCurrency(p.PriceData.BaseAsset),
      quote: decodeCurrency(p.PriceData.QuoteAsset),
      value: p.PriceData.AssetPrice === undefined ? null : decodePrice(p.PriceData.AssetPrice, p.PriceData.Scale),
    })),
  };
}

/** reads an oracle with an xrpl.js Client (read-only) */
export async function readOracle(client, account, documentId) {
  const r = await client.request({ command: "ledger_entry", oracle: { account, oracle_document_id: documentId }, ledger_index: "validated" });
  return decodeOracle(r.result.node);
}

/**
 * Verifies a decoded oracle against the source record and the expected pairs.
 * @returns {{ok: boolean, problems: string[]}}
 */
export function verifyOracle(decoded, record, expectedPairs) {
  const problems = [];
  const want = `sha256:${recordHash(record)}`;
  if (decoded.uri !== want) problems.push(`URI hash differs from the record (${decoded.uri} vs ${want})`);
  for (const { base, value } of expectedPairs) {
    const got = decoded.pairs.find((p) => p.base === base);
    if (!got) problems.push(`pair ${base} missing`);
    else if (got.value !== value) problems.push(`pair ${base}: on ledger ${got.value}, expected ${value}`);
  }
  return { ok: problems.length === 0, problems };
}
