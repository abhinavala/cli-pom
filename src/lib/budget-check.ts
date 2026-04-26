import { readJsonFile, getFilePath } from "../storage/index.js";
import { BudgetSchema, TransactionSchema } from "../schemas.js";
import { z } from "zod";
import type { Transaction } from "../schemas.js";

export type BudgetCheckResult = {
  status: "ok" | "warning" | "over";
  spent: number;
  limit: number;
  percentage: number;
};

export function checkBudgetAfterTransaction(transaction: Transaction): BudgetCheckResult | null {
  const budgets = readJsonFile(getFilePath("budgets.json"), z.array(BudgetSchema));
  const budget = budgets.find(
    (b) => b.category.toLowerCase() === transaction.category.toLowerCase()
  );

  if (!budget) return null;

  const transactions = readJsonFile(getFilePath("transactions.json"), z.array(TransactionSchema));

  // Compute month-to-date spending (negative amounts = expenses) for this category
  const txDate = new Date(transaction.date);
  const year = txDate.getFullYear();
  const month = String(txDate.getMonth() + 1).padStart(2, "0");
  const monthStart = `${year}-${month}-01`;
  // Use the last day of month by going to first of next month and checking <=
  const nextMonth = txDate.getMonth() === 11 ? 1 : txDate.getMonth() + 2;
  const nextYear = txDate.getMonth() === 11 ? year + 1 : year;
  const monthEnd = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;

  const mtdSpent = transactions
    .filter(
      (t) =>
        t.category.toLowerCase() === transaction.category.toLowerCase() &&
        t.date >= monthStart &&
        t.date < monthEnd &&
        t.amount < 0
    )
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);

  const percentage = budget.monthlyLimit > 0 ? mtdSpent / budget.monthlyLimit : 0;
  const warnAt = budget.warnAt ?? 0.8;

  let status: "ok" | "warning" | "over";
  if (mtdSpent > budget.monthlyLimit) {
    status = "over";
  } else if (percentage >= warnAt) {
    status = "warning";
  } else {
    status = "ok";
  }

  return { status, spent: mtdSpent, limit: budget.monthlyLimit, percentage };
}
