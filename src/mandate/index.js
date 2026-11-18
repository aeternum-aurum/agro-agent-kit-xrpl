// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 AETERNUM AURUM PARTNERS
/**
 * Module 2 — The agent's MANDATE: an open format for spending rules and a small engine that decides PAY or REFUSE, with the reason.
 *
 * "The agent only pays counterparties we verified, only within the limit, and only with data we measured."
 *  - Verified: the counterparty holds an accepted, unexpired XRPL Credential of the right type from the right issuer (read ON LEDGER).
 *  - Within the limit: per payment, per day, per counterparty per day, per ISO week, per year, number of payments per day,
 *    and an optional cap per physical unit (e.g. per tonne of freight).
 *  - Refusals build no transaction at all; every decision returns a reason you can log.
 *
 * The mandate is plain data: write it down BEFORE the agent runs (pre-registration), freeze it, and review changes as diffs.
 * Numbers in the examples are illustrative only.
 */

export const RIPPLE_EPOCH = 946684800; // 2000-01-01T00:00:00Z in Unix seconds
export const LSF_ACCEPTED = 0x00010000; // Credential accepted by its subject
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const hexAscii = (s) => Buffer.from(String(s), "ascii").toString("hex").toUpperCase();
const days = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

/** ISO week (YYYY-Www) of a YYYY-MM-DD day */
export function isoWeek(day) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 3); // Thursday decides the year
  const year = d.getUTCFullYear();
  return `${year}-W${String(1 + Math.floor((d - Date.UTC(year, 0, 1)) / 86400000 / 7)).padStart(2, "0")}`;
}

/** checks a mandate object; returns a list of problems (empty = valid) */
export function validateMandate(m) {
  const p = [];
  const pos = (v) => Number.isFinite(v) && v > 0;
  if (!m?.id) p.push("id is required");
  if (!["testnet", "devnet", "mainnet"].includes(m?.network)) p.push("network: testnet, devnet or mainnet");
  if (!m?.asset?.currency) p.push("asset.currency is required");
  const L = m?.limits ?? {};
  for (const k of ["perPayment", "perDay", "perCounterpartyPerDay"]) if (!pos(L[k])) p.push(`limits.${k} must be > 0`);
  if (!Number.isInteger(L.maxPaymentsPerDay) || L.maxPaymentsPerDay < 1) p.push("limits.maxPaymentsPerDay must be an integer >= 1");
  for (const k of ["perWeek", "perYear"]) if (L[k] !== undefined && !pos(L[k])) p.push(`limits.${k} must be > 0 when set`);
  if (L.perPayment > L.perDay) p.push("limits.perPayment cannot exceed limits.perDay");
  if (m?.unitCap && (!pos(m.unitCap.perUnit) || !m.unitCap.unit)) p.push("unitCap needs perUnit > 0 and a unit name");
  const c = m?.counterparty?.credential;
  if (!c?.issuer || !c?.type) p.push("counterparty.credential needs issuer and type");
  if (c && (!Number.isInteger(c.maxValidityDays) || c.maxValidityDays < 1)) p.push("counterparty.credential.maxValidityDays must be an integer >= 1");
  return p;
}

/** returns a deep-frozen, validated copy: a running agent cannot change its own mandate */
export function freezeMandate(m) {
  const problems = validateMandate(m);
  if (problems.length) throw new Error(`invalid mandate: ${problems.join("; ")}`);
  const deep = (o) => { Object.values(o).forEach((v) => v && typeof v === "object" && deep(v)); return Object.freeze(o); };
  return deep(structuredClone(m));
}

/** an XRPL Credential ledger object -> {issuer, type, validUntil}; null if not accepted or without expiration */
export function credentialFromLedger(node) {
  if (!node || node.LedgerEntryType !== "Credential") return null;
  if ((Number(node.Flags) & LSF_ACCEPTED) === 0) return null;
  if (!Number.isInteger(node.Expiration)) return null;
  return { issuer: node.Issuer, type: Buffer.from(node.CredentialType, "hex").toString("ascii"), validUntil: new Date((node.Expiration + RIPPLE_EPOCH) * 1000).toISOString().slice(0, 10) };
}

/** reads the counterparty's credential on ledger (read-only); null when absent */
export async function readCredential(client, subject, issuer, type) {
  try {
    const r = await client.request({ command: "ledger_entry", credential: { subject, issuer, credential_type: hexAscii(type) }, ledger_index: "validated" });
    return credentialFromLedger(r.result.node);
  } catch (e) {
    if (String(e?.data?.error ?? e?.message).includes("entryNotFound")) return null;
    throw e;
  }
}

/**
 * The decision. Pure function: same inputs, same answer.
 * @param {object} m  frozen mandate
 * @param {{to: string, amount: number, units?: number, asset: string, network: string, reason: string}} req
 * @param {{to: string, amount: number, day: string}[]} paid  payments already made (from your own log, with tx hashes)
 * @param {{issuer: string, type: string, validUntil: string}|null} credential  the counterparty's credential read on ledger
 * @param {string} today  YYYY-MM-DD
 * @returns {{allow: boolean, reason: string}}
 */
export function evaluate(m, req, paid, credential, today) {
  const L = m.limits;
  const no = (reason) => ({ allow: false, reason });
  if (req?.network !== m.network) return no(`network must be ${m.network}`);
  if (req?.asset !== m.asset.currency) return no(`asset must be ${m.asset.currency}`);
  if (!Number.isFinite(req?.amount) || req.amount <= 0) return no("amount must be > 0");
  if (req.amount > L.perPayment) return no(`above the per-payment limit (${L.perPayment})`);
  if (m.unitCap) {
    if (!(Number.isFinite(req.units) && req.units > 0)) return no(`request must state ${m.unitCap.unit}`);
    if (req.amount > req.units * m.unitCap.perUnit) return no(`above the cap per ${m.unitCap.unit} (${m.unitCap.perUnit})`);
  }
  if (!DAY.test(String(today ?? ""))) return no("today must be YYYY-MM-DD");
  const c = m.counterparty.credential;
  if (!credential) return no("counterparty has no accepted credential");
  if (credential.issuer !== c.issuer) return no("credential from another issuer");
  if (credential.type !== c.type) return no(`credential type is not ${c.type}`);
  if (!DAY.test(String(credential.validUntil ?? ""))) return no("credential without expiration");
  if (credential.validUntil < today) return no("credential expired");
  if (days(today, credential.validUntil) > c.maxValidityDays) return no(`credential valid for more than ${c.maxValidityDays} days`);
  if (!String(req.reason ?? "").trim()) return no("a reason is required");
  const valid = paid.filter((h) => DAY.test(String(h.day ?? "")));
  const sum = (xs) => xs.reduce((s, h) => s + h.amount, 0);
  const todays = valid.filter((h) => h.day === today);
  if (todays.length >= L.maxPaymentsPerDay) return no(`daily number of payments used up (${L.maxPaymentsPerDay})`);
  if (sum(todays) + req.amount > L.perDay) return no(`above the daily limit (${L.perDay})`);
  if (sum(todays.filter((h) => h.to === req.to)) + req.amount > L.perCounterpartyPerDay) return no(`above the per-counterparty daily limit (${L.perCounterpartyPerDay})`);
  if (L.perWeek && sum(valid.filter((h) => isoWeek(h.day) === isoWeek(today))) + req.amount > L.perWeek) return no(`above the weekly limit (${L.perWeek})`);
  if (L.perYear && sum(valid.filter((h) => h.day.slice(0, 4) === today.slice(0, 4))) + req.amount > L.perYear) return no(`above the yearly limit (${L.perYear})`);
  return { allow: true, reason: "within mandate" };
}

/** the Payment for an allowed request (issued token of the mandate's asset); the memo carries only your short reason */
export function buildPayment(m, from, req) {
  if (!m.asset.issuer) throw new Error("asset.issuer is required to pay an issued token");
  const reason = String(req.reason ?? "").trim();
  if (!reason || reason.length > 120) throw new Error("reason: 1 to 120 chars");
  const currency = m.asset.currency.length === 3 ? m.asset.currency : hexAscii(m.asset.currency).padEnd(40, "0");
  return { TransactionType: "Payment", Account: from, Destination: req.to, Amount: { currency, issuer: m.asset.issuer, value: String(req.amount) }, Memos: [{ Memo: { MemoType: hexAscii("mandate/reason"), MemoData: hexAscii(reason) } }] };
}
