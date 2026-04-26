import crypto from "node:crypto";
import stringSimilarity from "string-similarity";
import type { Transaction } from "../schemas.js";

export interface ProbableDuplicate {
  incoming: Transaction;
  match: Transaction;
  score: number;
}

export interface DedupResult {
  definite: Transaction[];
  probable: ProbableDuplicate[];
  clean: Transaction[];
}

export function normalizeDescription(desc: string): string {
  return desc
    .toLowerCase()
    .replace(/^(pos |ach |debit )/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function computeImportHash(
  tx: Pick<Transaction, "date" | "amount" | "description">
): string {
  const normalized = normalizeDescription(tx.description);
  const input = `${tx.date}|${tx.amount}|${normalized}`;
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function findDuplicates(
  incoming: Transaction[],
  existing: Transaction[]
): DedupResult {
  const existingByHash = new Map<string, Transaction>();
  for (const tx of existing) {
    if (tx.importHash) {
      existingByHash.set(tx.importHash, tx);
    }
  }

  const definite: Transaction[] = [];
  const probable: ProbableDuplicate[] = [];
  const clean: Transaction[] = [];

  for (const tx of incoming) {
    const hash = tx.importHash ?? computeImportHash(tx);

    if (existingByHash.has(hash)) {
      definite.push(tx);
      continue;
    }

    let bestMatch: { tx: Transaction; score: number } | null = null;

    for (const existingTx of existing) {
      const amountMatch = tx.amount === existingTx.amount ? 1 : 0;

      const txTime = new Date(tx.date).getTime();
      const exTime = new Date(existingTx.date).getTime();
      const daysDiff = Math.abs(txTime - exTime) / (1000 * 60 * 60 * 24);
      const dateMatch = daysDiff <= 2 ? 1 : 0;

      const normTx = normalizeDescription(tx.description);
      const normEx = normalizeDescription(existingTx.description);
      const descSimilarity = stringSimilarity.compareTwoStrings(normTx, normEx);

      const score = amountMatch * 0.4 + dateMatch * 0.3 + descSimilarity * 0.3;

      if (score > 0.85 && (!bestMatch || score > bestMatch.score)) {
        bestMatch = { tx: existingTx, score };
      }
    }

    if (bestMatch) {
      probable.push({ incoming: tx, match: bestMatch.tx, score: bestMatch.score });
    } else {
      clean.push(tx);
    }
  }

  return { definite, probable, clean };
}
