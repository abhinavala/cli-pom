import { Command } from "commander";
import chalk from "chalk";
import { readJsonFile, getFilePath, ensureInitialized } from "../storage/index.js";
import { AccountSchema, TransactionSchema } from "../schemas.js";
import { z } from "zod";
import {
  filterTransactions,
  groupByCategory,
  computeNetWorth,
  computeAccountBalance,
} from "../lib/reporting.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatCurrency(amount: number): string {
  return `$${Math.abs(amount).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function currentMonthStart(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function getLastNMonths(n: number): string[] {
  const months: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
    );
  }
  return months;
}

function lastDayOfMonth(yyyyMm: string): string {
  const [yearStr, monthStr] = yyyyMm.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  // Day 0 of next month is last day of current month
  const last = new Date(year, month, 0);
  return `${year}-${String(month).padStart(2, "0")}-${String(last.getDate()).padStart(2, "0")}`;
}

function renderBar(fraction: number, maxWidth = 30): string {
  const parts = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉", "█"];
  const filled = Math.max(0, Math.min(1, fraction)) * maxWidth;
  const full = Math.floor(filled);
  const partial = Math.floor((filled - full) * 8);
  return "█".repeat(full) + (partial > 0 ? (parts[partial] ?? "") : "");
}

// ─── Spending ───────────────────────────────────────────────────────────────

const spendingCmd = new Command("spending")
  .description("Category spending breakdown for a date range")
  .option("--from <date>", "Start date (ISO, default: start of current month)")
  .option("--to <date>", "End date (ISO, default: today)")
  .option("--account <accountId>", "Filter by account ID")
  .action((opts) => {
    ensureInitialized();

    const from: string = opts.from ?? currentMonthStart();
    const to: string = opts.to ?? today();

    const allTxs = readJsonFile(
      getFilePath("transactions.json"),
      z.array(TransactionSchema)
    );
    const filtered = filterTransactions(allTxs, {
      from,
      to,
      account: opts.account as string | undefined,
    });
    const expenses = filtered.filter((t) => t.amount < 0);

    if (expenses.length === 0) {
      console.log(chalk.yellow("No data for this period."));
      return;
    }

    const byCategory = groupByCategory(expenses);
    const totalSpent = expenses.reduce((s, t) => s + Math.abs(t.amount), 0);

    const sorted = [...byCategory.entries()].sort(
      (a, b) => Math.abs(b[1].total) - Math.abs(a[1].total)
    );

    const catWidth = Math.max(8, ...sorted.map(([c]) => c.length));
    const BAR_WIDTH = 28;
    const maxAmt = Math.abs(sorted[0]?.[1].total ?? 1);

    console.log(chalk.bold(`\nSpending Report: ${from} to ${to}`));
    console.log("─".repeat(catWidth + 54));
    console.log(
      chalk.bold(
        `${"Category".padEnd(catWidth)}  ${"Amount".padStart(12)}  ${"    %".padStart(6)}  ${"Cnt".padStart(3)}  Chart`
      )
    );
    console.log("─".repeat(catWidth + 54));

    for (const [cat, { total, count }] of sorted) {
      const abs = Math.abs(total);
      const pct = totalSpent > 0 ? (abs / totalSpent) * 100 : 0;
      const bar = renderBar(abs / maxAmt, BAR_WIDTH);
      const amtFormatted = formatCurrency(abs);
      const amtColored = chalk.red(`-${amtFormatted}`);
      const pctStr = `${pct.toFixed(1)}%`.padStart(6);

      console.log(
        `${cat.padEnd(catWidth)}  ${amtColored.padStart(12 + amtColored.length - amtFormatted.length - 1)}  ${pctStr}  ${String(count).padStart(3)}  ${chalk.cyan(bar)}`
      );
    }

    console.log("─".repeat(catWidth + 54));
    const totalFormatted = formatCurrency(totalSpent);
    console.log(
      `${"TOTAL".padEnd(catWidth)}  ${chalk.bold(chalk.red(`-${totalFormatted}`))}`
    );
  });

// ─── Trends ─────────────────────────────────────────────────────────────────

const trendsCmd = new Command("trends")
  .description("Month-over-month spending trends")
  .option("--months <n>", "Number of months to show", "6")
  .action((opts) => {
    ensureInitialized();

    const numMonths = parseInt(opts.months as string, 10);
    const months = getLastNMonths(numMonths);
    const allTxs = readJsonFile(
      getFilePath("transactions.json"),
      z.array(TransactionSchema)
    );

    interface MonthData {
      month: string;
      income: number;
      expenses: number;
      net: number;
      byCategory: Map<string, number>;
    }

    const monthlyData: MonthData[] = months.map((month) => {
      const txs = filterTransactions(allTxs, {
        from: `${month}-01`,
        to: lastDayOfMonth(month),
      });
      const income = txs
        .filter((t) => t.amount > 0)
        .reduce((s, t) => s + t.amount, 0);
      const expenses = txs
        .filter((t) => t.amount < 0)
        .reduce((s, t) => s + Math.abs(t.amount), 0);
      const byCategory = new Map<string, number>();
      for (const tx of txs.filter((t) => t.amount < 0)) {
        byCategory.set(
          tx.category,
          (byCategory.get(tx.category) ?? 0) + Math.abs(tx.amount)
        );
      }
      return { month, income, expenses, net: income - expenses, byCategory };
    });

    const hasData = monthlyData.some((d) => d.income > 0 || d.expenses > 0);
    if (!hasData) {
      console.log(chalk.yellow("No data for this period."));
      return;
    }

    console.log(chalk.bold(`\nSpending Trends: Last ${numMonths} months`));
    console.log("─".repeat(54));
    console.log(
      chalk.bold(
        `${"Month".padEnd(10)}  ${"Income".padStart(12)}  ${"Expenses".padStart(12)}  ${"Net".padStart(12)}`
      )
    );
    console.log("─".repeat(54));

    for (const { month, income, expenses, net } of monthlyData) {
      const incStr = formatCurrency(income).padStart(12);
      const expStr = formatCurrency(expenses).padStart(12);
      const netAbs = formatCurrency(Math.abs(net)).padStart(12);
      const netColored =
        net >= 0 ? chalk.green(`+${netAbs.trimStart()}`.padStart(12)) : chalk.red(`-${netAbs.trimStart()}`.padStart(12));
      console.log(
        `${month.padEnd(10)}  ${chalk.green(incStr)}  ${chalk.red(expStr)}  ${netColored}`
      );
    }

    // Per-category comparison
    const allCategories = new Set<string>();
    for (const d of monthlyData) {
      for (const cat of d.byCategory.keys()) allCategories.add(cat);
    }

    if (allCategories.size === 0) return;

    console.log(chalk.bold("\nCategory Trends (▲ increase / ▼ decrease from previous month):"));
    console.log("─".repeat(60));

    const catWidth = Math.max(8, ...[...allCategories].map((c) => c.length));
    const lastMonth = monthlyData[monthlyData.length - 1];
    const prevMonth = monthlyData[monthlyData.length - 2];

    interface CatChange {
      cat: string;
      change: number;
      pctChange: number;
      lastAmt: number;
    }

    const changes: CatChange[] = [...allCategories].map((cat) => {
      const lastAmt = lastMonth?.byCategory.get(cat) ?? 0;
      const prevAmt = prevMonth?.byCategory.get(cat) ?? 0;
      const change = lastAmt - prevAmt;
      const pctChange =
        prevAmt > 0 ? (change / prevAmt) * 100 : lastAmt > 0 ? 100 : 0;
      return { cat, change, pctChange, lastAmt };
    });
    changes.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));

    console.log(
      chalk.bold(
        `${"Category".padEnd(catWidth)}  ${months.map((m) => m.padStart(10)).join("  ")}  Change`
      )
    );
    console.log("─".repeat(catWidth + months.length * 12 + 20));

    for (const { cat, change, pctChange } of changes) {
      const amounts = monthlyData.map((d) => {
        const amt = d.byCategory.get(cat) ?? 0;
        return (amt > 0 ? formatCurrency(amt) : "-").padStart(10);
      });

      let changeStr = "";
      if (change > 0) {
        changeStr = chalk.red(
          `  ▲ ${formatCurrency(change)} (+${pctChange.toFixed(0)}%)`
        );
      } else if (change < 0) {
        changeStr = chalk.green(
          `  ▼ ${formatCurrency(Math.abs(change))} (-${Math.abs(pctChange).toFixed(0)}%)`
        );
      }

      console.log(`${cat.padEnd(catWidth)}  ${amounts.join("  ")}${changeStr}`);
    }
  });

// ─── Net Worth ──────────────────────────────────────────────────────────────

const networthCmd = new Command("networth")
  .description("Net worth over time")
  .option("--months <n>", "Number of months to show", "12")
  .action((opts) => {
    ensureInitialized();

    const numMonths = parseInt(opts.months as string, 10);
    const months = getLastNMonths(numMonths);
    const accounts = readJsonFile(
      getFilePath("accounts.json"),
      z.array(AccountSchema)
    );

    if (accounts.length === 0) {
      console.log(chalk.yellow("No accounts found."));
      return;
    }

    console.log(chalk.bold(`\nNet Worth: Last ${numMonths} months`));

    const accWidth = Math.max(9, ...accounts.map((a) => a.name.length));
    const colW = 12;

    // Per-account rows
    console.log("─".repeat(accWidth + 10 + months.length * (colW + 2)));
    console.log(
      chalk.bold(
        `${"Account".padEnd(accWidth)}  ${"Type".padEnd(8)}  ${months.map((m) => m.padStart(colW)).join("  ")}`
      )
    );
    console.log("─".repeat(accWidth + 10 + months.length * (colW + 2)));

    for (const account of accounts) {
      const balances = months.map((m) =>
        computeAccountBalance(account.id, lastDayOfMonth(m))
      );
      const cells = balances.map((b) => {
        const raw = b >= 0 ? formatCurrency(b) : `-${formatCurrency(Math.abs(b))}`;
        const colored = b < 0 ? chalk.red(raw) : chalk.green(raw);
        // Pad by visual length (raw), then apply color
        return colored.padStart(colW + colored.length - raw.length);
      });
      console.log(
        `${account.name.padEnd(accWidth)}  ${account.type.padEnd(8)}  ${cells.join("  ")}`
      );
    }

    console.log("─".repeat(accWidth + 10 + months.length * (colW + 2)));

    const totals = months.map((m) => computeNetWorth(lastDayOfMonth(m)));
    const totalCells = totals.map((t) => {
      const raw = t >= 0 ? formatCurrency(t) : `-${formatCurrency(Math.abs(t))}`;
      const colored =
        t >= 0
          ? chalk.bold(chalk.green(raw))
          : chalk.bold(chalk.red(raw));
      return colored.padStart(colW + colored.length - raw.length);
    });
    console.log(
      `${"NET WORTH".padEnd(accWidth)}  ${"".padEnd(8)}  ${totalCells.join("  ")}`
    );

    // ASCII line chart
    const nonZero = totals.some((t) => t !== 0);
    if (!nonZero) {
      console.log(chalk.yellow("\nNo data for this period."));
      return;
    }

    console.log(chalk.bold("\nNet Worth Trend:"));
    renderLineChart(months, totals);
  });

function renderLineChart(months: string[], values: number[]): void {
  const HEIGHT = 8;
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const range = maxVal - minVal || 1;

  const grid: string[][] = Array.from({ length: HEIGHT }, () =>
    Array(values.length).fill(" ")
  );

  const rowOf = (v: number): number =>
    HEIGHT - 1 - Math.round(((v - minVal) / range) * (HEIGHT - 1));

  for (let i = 0; i < values.length; i++) {
    grid[rowOf(values[i]!)]![i] = "●";
  }

  // Connect adjacent dots vertically
  for (let i = 0; i < values.length - 1; i++) {
    const r1 = rowOf(values[i]!);
    const r2 = rowOf(values[i + 1]!);
    const lo = Math.min(r1, r2);
    const hi = Math.max(r1, r2);
    for (let r = lo + 1; r < hi; r++) {
      if (grid[r]![i] === " ") grid[r]![i] = "│";
    }
  }

  const labelW = 13;
  for (let r = 0; r < HEIGHT; r++) {
    const yVal = maxVal - (r / (HEIGHT - 1)) * range;
    const label =
      r === 0
        ? formatCurrency(maxVal)
        : r === HEIGHT - 1
        ? formatCurrency(minVal)
        : "";
    console.log(`${label.padStart(labelW)} │ ${grid[r]!.join("  ")}`);
  }

  console.log(" ".repeat(labelW) + " └" + "─".repeat(values.length * 3));
  console.log(
    " ".repeat(labelW + 3) + months.map((m) => m.slice(5)).join("  ")
  );
}

// ─── Exports ────────────────────────────────────────────────────────────────

export const reportCommand = new Command("report")
  .description("Generate financial reports")
  .addCommand(spendingCmd)
  .addCommand(trendsCmd)
  .addCommand(networthCmd);

export function registerReportCommands(program: Command): void {
  program.addCommand(reportCommand);
}
