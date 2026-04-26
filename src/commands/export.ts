import { Command } from "commander";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { readJsonFile, getFilePath } from "../storage/index.js";
import {
  AccountSchema,
  TransactionSchema,
  BudgetSchema,
  RecurringRuleSchema,
} from "../schemas.js";
import type { Account, Transaction, Budget, RecurringRule } from "../schemas.js";
import { z } from "zod";

function formatAmount(amount: number): string {
  const abs = Math.abs(amount);
  const fixed = abs.toFixed(2);
  const [intPart, decPart] = fixed.split(".");
  const formatted =
    intPart!.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "." + decPart;
  return amount < 0 ? `-$${formatted}` : `$${formatted}`;
}

function getMonthBounds(month: string): { start: string; end: string } {
  const [yearStr, monStr] = month.split("-");
  const year = parseInt(yearStr!, 10);
  const mon = parseInt(monStr!, 10);
  const start = `${year}-${String(mon).padStart(2, "0")}-01`;
  const nextMon = mon === 12 ? 1 : mon + 1;
  const nextYear = mon === 12 ? year + 1 : year;
  const end = `${nextYear}-${String(nextMon).padStart(2, "0")}-01`;
  return { start, end };
}

function getPriorMonth(month: string): string {
  const [yearStr, monStr] = month.split("-");
  const year = parseInt(yearStr!, 10);
  const mon = parseInt(monStr!, 10);
  const prevMon = mon === 1 ? 12 : mon - 1;
  const prevYear = mon === 1 ? year - 1 : year;
  return `${prevYear}-${String(prevMon).padStart(2, "0")}`;
}

function filterForMonth(
  transactions: Transaction[],
  month: string
): Transaction[] {
  const { start, end } = getMonthBounds(month);
  return transactions.filter((t) => t.date >= start && t.date < end);
}

function computeMonthEndBalance(
  account: Account,
  transactions: Transaction[],
  month: string
): number {
  const { end } = getMonthBounds(month);
  const txSum = transactions
    .filter((t) => t.accountId === account.id && t.date < end)
    .reduce((sum, t) => sum + t.amount, 0);
  return account.startingBalance + txSum;
}

function monthLabel(month: string): string {
  const [yearStr, monStr] = month.split("-");
  return new Date(parseInt(yearStr!, 10), parseInt(monStr!, 10) - 1, 1).toLocaleString(
    "en-US",
    { month: "long", year: "numeric" }
  );
}

export function generateMarkdown(
  month: string,
  accounts: Account[],
  allTransactions: Transaction[],
  budgets: Budget[],
  rules: RecurringRule[]
): string {
  const monthTxs = filterForMonth(allTransactions, month);
  const priorMonth = getPriorMonth(month);
  const priorTxs = filterForMonth(allTransactions, priorMonth);

  const lines: string[] = [];

  // ── 1. Header ──────────────────────────────────────────────────────────────
  const timestamp = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";
  lines.push(`# Financial Summary — ${monthLabel(month)}`);
  lines.push(`_Generated: ${timestamp}_`);
  lines.push("");

  // ── 2. Account Balances ────────────────────────────────────────────────────
  lines.push("## Account Balances");
  lines.push("");
  lines.push("| Account | Type | Balance |");
  lines.push("|---------|------|---------|");

  let netWorth = 0;
  for (const account of accounts) {
    const balance = computeMonthEndBalance(account, allTransactions, month);
    netWorth += balance;
    lines.push(`| ${account.name} | ${account.type} | ${formatAmount(balance)} |`);
  }
  lines.push(`| **Net Worth** | | **${formatAmount(netWorth)}** |`);
  lines.push("");

  // ── 3. Income vs Expenses ──────────────────────────────────────────────────
  const totalIncome = monthTxs
    .filter((t) => t.amount > 0)
    .reduce((sum, t) => sum + t.amount, 0);
  const totalExpenses = monthTxs
    .filter((t) => t.amount < 0)
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);
  const netSavings = totalIncome - totalExpenses;
  const savingsRate = totalIncome > 0 ? (netSavings / totalIncome) * 100 : 0;

  lines.push("## Income vs Expenses");
  lines.push("");
  lines.push("| Metric | Amount |");
  lines.push("|--------|--------|");
  lines.push(`| Total Income | ${formatAmount(totalIncome)} |`);
  lines.push(`| Total Expenses | ${formatAmount(totalExpenses)} |`);
  lines.push(`| Net Savings | ${formatAmount(netSavings)} |`);
  lines.push(`| Savings Rate | ${savingsRate.toFixed(1)}% |`);
  lines.push("");

  // ── 4. Spending by Category ────────────────────────────────────────────────
  const categoryMap = new Map<string, number>();
  for (const tx of monthTxs.filter((t) => t.amount < 0)) {
    categoryMap.set(
      tx.category,
      (categoryMap.get(tx.category) ?? 0) + Math.abs(tx.amount)
    );
  }
  const sortedCategories = [...categoryMap.entries()].sort((a, b) => b[1] - a[1]);

  lines.push("## Spending by Category");
  lines.push("");
  lines.push("| Category | Amount | % of Total | Budget Limit | Status |");
  lines.push("|----------|--------|------------|--------------|--------|");

  if (sortedCategories.length === 0) {
    lines.push("| — | $0.00 | 0.0% | — | — |");
  } else {
    for (const [category, amount] of sortedCategories) {
      const pct = totalExpenses > 0 ? (amount / totalExpenses) * 100 : 0;
      const budget = budgets.find(
        (b) => b.category.toLowerCase() === category.toLowerCase()
      );
      const budgetLimit = budget ? formatAmount(budget.monthlyLimit) : "—";
      let status = "—";
      if (budget) {
        const warnAt = budget.warnAt ?? 0.8;
        if (amount > budget.monthlyLimit) {
          status = "Over";
        } else if (amount >= budget.monthlyLimit * warnAt) {
          status = "Warning";
        } else {
          status = "OK";
        }
      }
      lines.push(
        `| ${category} | ${formatAmount(amount)} | ${pct.toFixed(1)}% | ${budgetLimit} | ${status} |`
      );
    }
  }
  lines.push("");

  // ── 5. Top Transactions ────────────────────────────────────────────────────
  const accountMap = new Map(accounts.map((a) => [a.id, a.name]));
  const topTxs = [...monthTxs]
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
    .slice(0, 10);

  lines.push("## Top Transactions");
  lines.push("");
  lines.push("| Date | Description | Amount | Category | Account |");
  lines.push("|------|-------------|--------|----------|---------|");

  if (topTxs.length === 0) {
    lines.push("| — | No transactions | — | — | — |");
  } else {
    for (const tx of topTxs) {
      const accName = accountMap.get(tx.accountId) ?? tx.accountId;
      lines.push(
        `| ${tx.date} | ${tx.description} | ${formatAmount(tx.amount)} | ${tx.category} | ${accName} |`
      );
    }
  }
  lines.push("");

  // ── 6. Budget Status (only if budgets exist) ───────────────────────────────
  if (budgets.length > 0) {
    lines.push("## Budget Status");
    lines.push("");
    lines.push("| Category | Limit | Spent | Remaining | % Used |");
    lines.push("|----------|-------|-------|-----------|--------|");

    for (const budget of budgets) {
      const spent = categoryMap.get(budget.category) ?? 0;
      const remaining = budget.monthlyLimit - spent;
      const pctUsed =
        budget.monthlyLimit > 0 ? (spent / budget.monthlyLimit) * 100 : 0;
      lines.push(
        `| ${budget.category} | ${formatAmount(budget.monthlyLimit)} | ${formatAmount(spent)} | ${formatAmount(remaining)} | ${pctUsed.toFixed(1)}% |`
      );
    }
    lines.push("");
  }

  // ── 7. Recurring Rules Summary (only if rules exist) ──────────────────────
  if (rules.length > 0) {
    lines.push("## Recurring Rules");
    lines.push("");
    lines.push("| Description | Category | Amount | Schedule |");
    lines.push("|-------------|----------|--------|----------|");

    for (const rule of rules) {
      lines.push(
        `| ${rule.description} | ${rule.category} | ${formatAmount(rule.amount)} | ${rule.rrule} |`
      );
    }
    lines.push("");
  }

  // ── 8. Month-over-Month Comparison (only if prior month data exists) ───────
  if (priorTxs.length > 0) {
    const priorIncome = priorTxs
      .filter((t) => t.amount > 0)
      .reduce((sum, t) => sum + t.amount, 0);
    const priorExpenses = priorTxs
      .filter((t) => t.amount < 0)
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);
    const priorNetSavings = priorIncome - priorExpenses;

    lines.push(
      `## Month-over-Month Comparison (vs ${monthLabel(priorMonth)})`
    );
    lines.push("");
    lines.push("| Metric | This Month | Prior Month | Change |");
    lines.push("|--------|------------|-------------|--------|");
    lines.push(
      `| Total Spending | ${formatAmount(totalExpenses)} | ${formatAmount(priorExpenses)} | ${formatAmount(totalExpenses - priorExpenses)} |`
    );
    lines.push(
      `| Total Income | ${formatAmount(totalIncome)} | ${formatAmount(priorIncome)} | ${formatAmount(totalIncome - priorIncome)} |`
    );
    lines.push(
      `| Net Savings | ${formatAmount(netSavings)} | ${formatAmount(priorNetSavings)} | ${formatAmount(netSavings - priorNetSavings)} |`
    );
    lines.push("");
  }

  return lines.join("\n");
}

export const exportCommand = new Command("export")
  .description("Export a markdown financial summary for a given month")
  .option("--month <YYYY-MM>", "Month to export in YYYY-MM format")
  .option("--output <path>", "Output file path")
  .action((opts) => {
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const month: string = opts.month ?? currentMonth;

    if (!/^\d{4}-\d{2}$/.test(month)) {
      console.error(`Error: --month must be in YYYY-MM format, got "${month}"`);
      process.exit(1);
    }

    const outputPath: string =
      opts.output ?? join(process.cwd(), `fin-report-${month}.md`);

    const accounts = readJsonFile(
      getFilePath("accounts.json"),
      z.array(AccountSchema)
    );
    const allTransactions = readJsonFile(
      getFilePath("transactions.json"),
      z.array(TransactionSchema)
    );
    const budgets = readJsonFile(
      getFilePath("budgets.json"),
      z.array(BudgetSchema)
    );
    const rules = readJsonFile(
      getFilePath("rules.json"),
      z.array(RecurringRuleSchema)
    );

    const markdown = generateMarkdown(
      month,
      accounts,
      allTransactions,
      budgets,
      rules
    );

    writeFileSync(outputPath, markdown, "utf-8");
    console.log(`✓ Report written to ${outputPath}`);
  });

export function registerExportCommands(program: Command): void {
  program.addCommand(exportCommand);
}
