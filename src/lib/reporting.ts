import { readJsonFile, getFilePath } from "../storage/index.js";
import { AccountSchema, TransactionSchema } from "../schemas.js";
import type { Transaction } from "../schemas.js";
import { z } from "zod";

export interface FilterOptions {
  from?: string;
  to?: string;
  account?: string;
  category?: string;
}

export function filterTransactions(
  txs: Transaction[],
  opts: FilterOptions
): Transaction[] {
  let result = txs;
  if (opts.from) {
    result = result.filter((t) => t.date >= opts.from!);
  }
  if (opts.to) {
    result = result.filter((t) => t.date <= opts.to!);
  }
  if (opts.account) {
    result = result.filter((t) => t.accountId === opts.account);
  }
  if (opts.category) {
    result = result.filter(
      (t) => t.category.toLowerCase() === opts.category!.toLowerCase()
    );
  }
  return result;
}

export function groupByCategory(
  txs: Transaction[]
): Map<string, { total: number; count: number; transactions: Transaction[] }> {
  const map = new Map<
    string,
    { total: number; count: number; transactions: Transaction[] }
  >();
  for (const tx of txs) {
    const key = tx.category;
    if (!map.has(key)) {
      map.set(key, { total: 0, count: 0, transactions: [] });
    }
    const entry = map.get(key)!;
    entry.total += tx.amount;
    entry.count++;
    entry.transactions.push(tx);
  }
  return map;
}

export function groupByMonth(txs: Transaction[]): Map<string, Transaction[]> {
  const map = new Map<string, Transaction[]>();
  for (const tx of txs) {
    const key = tx.date.slice(0, 7); // YYYY-MM
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key)!.push(tx);
  }
  return map;
}

export function computeAccountBalance(
  accountId: string,
  asOfDate: string
): number {
  const accounts = readJsonFile(
    getFilePath("accounts.json"),
    z.array(AccountSchema)
  );
  const transactions = readJsonFile(
    getFilePath("transactions.json"),
    z.array(TransactionSchema)
  );

  const account = accounts.find((a) => a.id === accountId);
  if (!account) return 0;

  const txSum = transactions
    .filter((t) => t.accountId === accountId && t.date <= asOfDate)
    .reduce((sum, t) => sum + t.amount, 0);

  return account.startingBalance + txSum;
}

export function computeNetWorth(asOfDate: string): number {
  const accounts = readJsonFile(
    getFilePath("accounts.json"),
    z.array(AccountSchema)
  );

  return accounts.reduce((total, account) => {
    const balance = computeAccountBalance(account.id, asOfDate);
    // Credit card balances are naturally negative when you owe money;
    // summing all balances gives the correct net worth.
    return total + balance;
  }, 0);
}
