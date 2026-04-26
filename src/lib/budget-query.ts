import { readJsonFile, getFilePath } from "../storage/index.js";
import { BudgetSchema, TransactionSchema } from "../schemas.js";
import { z } from "zod";

export type BudgetStatus = {
  category: string;
  monthlyLimit: number;
  warnAt: number;
  spent: number;
  percentage: number;
  status: "ok" | "warning" | "over";
};

function readBudgets() {
  return readJsonFile(getFilePath("budgets.json"), z.array(BudgetSchema));
}

function getMonthBounds(month: string): { start: string; end: string } {
  const [year, mon] = month.split("-").map(Number);
  const start = `${year}-${String(mon).padStart(2, "0")}-01`;
  const nextMon = mon === 12 ? 1 : mon + 1;
  const nextYear = mon === 12 ? year + 1 : year;
  const end = `${nextYear}-${String(nextMon).padStart(2, "0")}-01`;
  return { start, end };
}

export function getCategorySpending(category: string, month: string): number {
  const transactions = readJsonFile(getFilePath("transactions.json"), z.array(TransactionSchema));
  const { start, end } = getMonthBounds(month);

  return transactions
    .filter(
      (t) =>
        t.category.toLowerCase() === category.toLowerCase() &&
        t.date >= start &&
        t.date < end &&
        t.amount < 0
    )
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);
}

export function getAllBudgetStatuses(month?: string): BudgetStatus[] {
  const currentMonth =
    month ??
    (() => {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    })();

  const budgets = readBudgets();

  return budgets.map((budget) => {
    const spent = getCategorySpending(budget.category, currentMonth);
    const percentage = budget.monthlyLimit > 0 ? spent / budget.monthlyLimit : 0;
    const warnAt = budget.warnAt ?? 0.8;

    let status: "ok" | "warning" | "over";
    if (spent > budget.monthlyLimit) {
      status = "over";
    } else if (percentage >= warnAt) {
      status = "warning";
    } else {
      status = "ok";
    }

    return {
      category: budget.category,
      monthlyLimit: budget.monthlyLimit,
      warnAt,
      spent,
      percentage,
      status,
    };
  });
}
