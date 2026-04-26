import { Command } from "commander";
import chalk from "chalk";
import { readJsonFile, writeJsonFile, getFilePath, ensureInitialized } from "../storage/index.js";
import { BudgetSchema } from "../schemas.js";
import { z } from "zod";
import { getAllBudgetStatuses } from "../lib/budget-query.js";

const BUDGETS_FILE = "budgets.json";

function readBudgets() {
  return readJsonFile(getFilePath(BUDGETS_FILE), z.array(BudgetSchema));
}

function buildProgressBar(percentage: number, width: number = 20): string {
  const clamped = Math.min(percentage, 1);
  const filled = Math.round(clamped * width);
  const empty = width - filled;
  return "▓".repeat(filled) + "░".repeat(empty);
}

const setCmd = new Command("set")
  .description("Create or update a budget")
  .option("--category <category>", "Budget category")
  .option("--limit <limit>", "Monthly spending limit")
  .option("--warn <warn>", "Warning threshold (0-1, default 0.8)", "0.8")
  .action((opts) => {
    ensureInitialized();

    if (!opts.category) {
      console.error(chalk.red("Error: --category is required"));
      process.exit(1);
    }

    const limit = parseFloat(opts.limit);
    if (isNaN(limit) || limit < 0) {
      console.error(chalk.red("Error: --limit must be a non-negative number"));
      process.exit(1);
    }

    const warn = parseFloat(opts.warn);
    if (isNaN(warn) || warn < 0 || warn > 1) {
      console.error(chalk.red("Error: --warn must be a number between 0 and 1"));
      process.exit(1);
    }

    const budgets = readBudgets();
    const existingIndex = budgets.findIndex(
      (b) => b.category.toLowerCase() === opts.category.toLowerCase()
    );

    const entry = {
      category: opts.category,
      monthlyLimit: limit,
      warnAt: warn,
    };

    if (existingIndex >= 0) {
      budgets[existingIndex] = entry;
      console.log(chalk.green(`✓ Budget updated for category "${opts.category}": $${limit.toFixed(2)}/mo (warn at ${Math.round(warn * 100)}%)`));
    } else {
      budgets.push(entry);
      console.log(chalk.green(`✓ Budget created for category "${opts.category}": $${limit.toFixed(2)}/mo (warn at ${Math.round(warn * 100)}%)`));
    }

    writeJsonFile(getFilePath(BUDGETS_FILE), budgets);
  });

const statusCmd = new Command("status")
  .description("Show budget progress for current month")
  .option("--month <month>", "Month in YYYY-MM format (defaults to current month)")
  .action((opts) => {
    ensureInitialized();

    const statuses = getAllBudgetStatuses(opts.month);

    if (statuses.length === 0) {
      console.log(chalk.yellow("No budgets found. Use 'fin budget set' to create one."));
      return;
    }

    // Sort by percentage descending (most-spent-into first)
    statuses.sort((a, b) => b.percentage - a.percentage);

    const month = opts.month ?? (() => {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    })();

    console.log(chalk.bold(`\nBudget Status — ${month}\n`));

    for (const s of statuses) {
      const bar = buildProgressBar(s.percentage);
      const pct = `${Math.round(s.percentage * 100)}%`;
      const spentStr = `$${s.spent.toFixed(2)}`;
      const limitStr = `$${s.monthlyLimit.toFixed(2)}`;

      let coloredBar: string;
      let statusIcon: string;
      if (s.status === "over") {
        coloredBar = chalk.red(bar);
        statusIcon = chalk.red("● OVER");
      } else if (s.status === "warning") {
        coloredBar = chalk.yellow(bar);
        statusIcon = chalk.yellow("● WARN");
      } else {
        coloredBar = chalk.green(bar);
        statusIcon = chalk.green("● OK");
      }

      console.log(`${chalk.bold(s.category)}`);
      console.log(`  [${coloredBar}] ${pct}  ${spentStr} / ${limitStr}  ${statusIcon}`);
    }

    console.log();
  });

const listCmd = new Command("list")
  .description("List all budget rules")
  .action(() => {
    ensureInitialized();

    const budgets = readBudgets();

    if (budgets.length === 0) {
      console.log(chalk.yellow("No budgets found. Use 'fin budget set' to create one."));
      return;
    }

    const catWidth = Math.max(8, ...budgets.map((b) => b.category.length));

    console.log(
      chalk.bold(`${"Category".padEnd(catWidth)}  ${"Limit".padStart(10)}  ${"Warn At".padStart(8)}`)
    );
    console.log("─".repeat(catWidth + 22));

    for (const b of budgets) {
      const limitStr = `$${b.monthlyLimit.toFixed(2)}`;
      const warnStr = `${Math.round((b.warnAt ?? 0.8) * 100)}%`;
      console.log(`${b.category.padEnd(catWidth)}  ${limitStr.padStart(10)}  ${warnStr.padStart(8)}`);
    }
  });

const removeCmd = new Command("remove")
  .description("Remove a budget")
  .option("--category <category>", "Budget category to remove")
  .action((opts) => {
    ensureInitialized();

    if (!opts.category) {
      console.error(chalk.red("Error: --category is required"));
      process.exit(1);
    }

    const budgets = readBudgets();
    const index = budgets.findIndex(
      (b) => b.category.toLowerCase() === opts.category.toLowerCase()
    );

    if (index === -1) {
      console.error(chalk.red(`Error: No budget found for category "${opts.category}"`));
      process.exit(1);
    }

    const removed = budgets.splice(index, 1)[0];
    writeJsonFile(getFilePath(BUDGETS_FILE), budgets);

    console.log(chalk.green(`✓ Budget removed for category "${removed.category}"`));
  });

export const budgetCommand = new Command("budget")
  .description("Manage budgets")
  .addCommand(setCmd)
  .addCommand(statusCmd)
  .addCommand(listCmd)
  .addCommand(removeCmd);

export function registerBudgetCommands(program: Command): void {
  program.addCommand(budgetCommand);
}
