import { Command } from "commander";
import { nanoid } from "nanoid";
import chalk from "chalk";
import { input, number as inquirerNumber } from "@inquirer/prompts";
import { readJsonFile, writeJsonFile, getFilePath, ensureInitialized } from "../storage/index.js";
import { AccountSchema, TransactionSchema } from "../schemas.js";
import { z } from "zod";
import { checkBudgetAfterTransaction } from "../lib/budget-check.js";

const ACCOUNTS_FILE = "accounts.json";
const TRANSACTIONS_FILE = "transactions.json";

function readAccounts() {
  return readJsonFile(getFilePath(ACCOUNTS_FILE), z.array(AccountSchema));
}

function readTransactions() {
  return readJsonFile(getFilePath(TRANSACTIONS_FILE), z.array(TransactionSchema));
}

function formatAmount(amount: number): string {
  const formatted = `$${Math.abs(amount).toFixed(2)}`;
  return amount < 0 ? `-${formatted}` : `+${formatted}`;
}

function colorAmount(amount: number): string {
  const formatted = formatAmount(amount);
  return amount < 0 ? chalk.red(formatted) : chalk.green(formatted);
}

const addCmd = new Command("add")
  .description("Add a new transaction")
  .option("--account <account>", "Account name or ID")
  .option("--amount <amount>", "Amount (positive for income, negative for expenses)")
  .option("--category <category>", "Category")
  .option("--description <description>", "Description")
  .option("--date <date>", "Date (ISO format, defaults to today)")
  .option("--notes <notes>", "Optional notes")
  .action(async (opts) => {
    ensureInitialized();

    const accounts = readAccounts();

    // Account lookup
    let accountInput: string = opts.account;
    if (!accountInput) {
      accountInput = await input({ message: "Account (name or ID):" });
    }

    const account = accounts.find(
      (a) =>
        a.id === accountInput ||
        a.name.toLowerCase().includes(accountInput.toLowerCase())
    );

    if (!account) {
      console.error(chalk.red(`Error: Account not found: "${accountInput}"`));
      process.exit(1);
    }

    // Amount
    let amount: number;
    if (opts.amount !== undefined) {
      amount = parseFloat(opts.amount);
      if (isNaN(amount)) {
        console.error(chalk.red("Error: Invalid amount"));
        process.exit(1);
      }
    } else {
      const amountInput = await inquirerNumber({
        message: "Amount (positive=income, negative=expense):",
      });
      amount = amountInput ?? 0;
    }

    // Category
    let category: string = opts.category;
    if (!category) {
      category = await input({ message: "Category:" });
    }

    // Description
    let description: string = opts.description;
    if (!description) {
      description = await input({ message: "Description:" });
    }

    // Date
    const date: string = opts.date ?? new Date().toISOString().slice(0, 10);

    // Notes
    const notes: string | undefined = opts.notes;

    const transaction = {
      id: nanoid(),
      accountId: account.id,
      amount,
      category,
      description,
      date,
      notes,
      createdAt: new Date().toISOString(),
    };

    const transactions = readTransactions();
    transactions.push(transaction);
    writeJsonFile(getFilePath(TRANSACTIONS_FILE), transactions);

    console.log(chalk.green(`✓ Transaction added:`));
    console.log(`  ID:          ${transaction.id}`);
    console.log(`  Account:     ${account.name}`);
    console.log(`  Amount:      ${colorAmount(amount)}`);
    console.log(`  Category:    ${category}`);
    console.log(`  Description: ${description}`);
    console.log(`  Date:        ${date}`);

    // Budget check
    const budgetResult = checkBudgetAfterTransaction(transaction);
    if (budgetResult && budgetResult.status !== "ok") {
      const pct = (budgetResult.percentage * 100).toFixed(1);
      const spent = `$${budgetResult.spent.toFixed(2)}`;
      const limit = `$${budgetResult.limit.toFixed(2)}`;
      if (budgetResult.status === "over") {
        console.log(
          chalk.red(
            `⚠ Budget exceeded for "${category}": ${spent} spent of ${limit} limit (${pct}%)`
          )
        );
      } else {
        console.log(
          chalk.yellow(
            `⚠ Budget warning for "${category}": ${spent} spent of ${limit} limit (${pct}%)`
          )
        );
      }
    }
  });

const listCmd = new Command("list")
  .description("List transactions")
  .option("--account <account>", "Filter by account name or ID")
  .option("--category <category>", "Filter by category")
  .option("--from <date>", "Start date (ISO format)")
  .option("--to <date>", "End date (ISO format)")
  .option("--limit <limit>", "Max transactions to show", "20")
  .action((opts) => {
    ensureInitialized();

    const accounts = readAccounts();
    let transactions = readTransactions();

    // Filters
    if (opts.account) {
      const account = accounts.find(
        (a) =>
          a.id === opts.account ||
          a.name.toLowerCase().includes(opts.account.toLowerCase())
      );
      if (account) {
        transactions = transactions.filter((t) => t.accountId === account.id);
      } else {
        console.log(chalk.yellow(`No account matching "${opts.account}" found.`));
        return;
      }
    }

    if (opts.category) {
      transactions = transactions.filter((t) =>
        t.category.toLowerCase().includes(opts.category.toLowerCase())
      );
    }

    if (opts.from) {
      transactions = transactions.filter((t) => t.date >= opts.from);
    }

    if (opts.to) {
      transactions = transactions.filter((t) => t.date <= opts.to);
    }

    // Sort by date descending
    transactions.sort((a, b) => b.date.localeCompare(a.date));

    const limit = parseInt(opts.limit, 10);
    const total = transactions.length;
    const displayed = transactions.slice(0, limit);

    if (displayed.length === 0) {
      console.log(chalk.yellow("No transactions found."));
      return;
    }

    const accountMap = new Map(accounts.map((a) => [a.id, a.name]));

    // Column widths
    const dateWidth = 10;
    const descWidth = Math.min(
      30,
      Math.max(11, ...displayed.map((t) => t.description.length))
    );
    const amtWidth = 12;
    const catWidth = Math.min(
      20,
      Math.max(8, ...displayed.map((t) => t.category.length))
    );
    const accWidth = Math.min(
      15,
      Math.max(7, ...displayed.map((t) => (accountMap.get(t.accountId) ?? "").length))
    );

    console.log(
      chalk.bold(
        `${"Date".padEnd(dateWidth)}  ${"Description".padEnd(descWidth)}  ${"Amount".padStart(amtWidth)}  ${"Category".padEnd(catWidth)}  ${"Account".padEnd(accWidth)}`
      )
    );
    console.log("─".repeat(dateWidth + descWidth + amtWidth + catWidth + accWidth + 8));

    let runningTotal = 0;
    for (const tx of displayed) {
      runningTotal += tx.amount;
      const accName = accountMap.get(tx.accountId) ?? tx.accountId;
      const desc =
        tx.description.length > descWidth
          ? tx.description.slice(0, descWidth - 1) + "…"
          : tx.description;
      const cat =
        tx.category.length > catWidth
          ? tx.category.slice(0, catWidth - 1) + "…"
          : tx.category;
      const acc =
        accName.length > accWidth ? accName.slice(0, accWidth - 1) + "…" : accName;
      const amtStr = formatAmount(tx.amount);
      const coloredAmt = colorAmount(tx.amount);
      const amtPad = amtWidth + (coloredAmt.length - amtStr.length);

      console.log(
        `${tx.date.padEnd(dateWidth)}  ${desc.padEnd(descWidth)}  ${coloredAmt.padStart(amtPad)}  ${cat.padEnd(catWidth)}  ${acc}`
      );
    }

    console.log("─".repeat(dateWidth + descWidth + amtWidth + catWidth + accWidth + 8));
    const totalStr = formatAmount(runningTotal);
    const coloredTotal = runningTotal < 0 ? chalk.red(totalStr) : chalk.green(totalStr);
    const limitNote =
      total > limit ? chalk.gray(` (showing ${limit} of ${total})`) : "";
    console.log(`Total: ${coloredTotal}${limitNote}`);
  });

const removeCmd = new Command("remove")
  .description("Remove a transaction by ID")
  .option("--id <id>", "Transaction ID")
  .action((opts) => {
    ensureInitialized();

    if (!opts.id) {
      console.error(chalk.red("Error: --id is required"));
      process.exit(1);
    }

    const transactions = readTransactions();
    const idx = transactions.findIndex((t) => t.id === opts.id);

    if (idx === -1) {
      console.error(chalk.red(`Error: Transaction not found: "${opts.id}"`));
      process.exit(1);
    }

    const [removed] = transactions.splice(idx, 1);
    writeJsonFile(getFilePath(TRANSACTIONS_FILE), transactions);

    console.log(chalk.green(`✓ Transaction removed:`));
    console.log(`  ID:          ${removed.id}`);
    console.log(`  Amount:      ${colorAmount(removed.amount)}`);
    console.log(`  Description: ${removed.description}`);
    console.log(`  Date:        ${removed.date}`);
  });

export const txCommand = new Command("tx")
  .description("Manage transactions")
  .addCommand(addCmd)
  .addCommand(listCmd)
  .addCommand(removeCmd);

export function registerTransactionCommands(program: Command): void {
  program.addCommand(txCommand);
}
