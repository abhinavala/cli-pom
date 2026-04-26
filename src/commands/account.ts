import { Command } from "commander";
import { nanoid } from "nanoid";
import chalk from "chalk";
import { input, select, number } from "@inquirer/prompts";
import { readJsonFile, writeJsonFile, getFilePath, ensureInitialized } from "../storage/index.js";
import { AccountSchema, TransactionSchema } from "../schemas.js";
import { z } from "zod";

const ACCOUNTS_FILE = "accounts.json";
const TRANSACTIONS_FILE = "transactions.json";

function readAccounts() {
  return readJsonFile(getFilePath(ACCOUNTS_FILE), z.array(AccountSchema));
}

function readTransactions() {
  return readJsonFile(getFilePath(TRANSACTIONS_FILE), z.array(TransactionSchema));
}

const addCmd = new Command("add")
  .description("Add a new account")
  .option("--name <name>", "Account name")
  .option("--type <type>", "Account type (checking|savings|credit)")
  .option("--balance <balance>", "Starting balance", "0")
  .action(async (opts) => {
    ensureInitialized();

    let name: string = opts.name;
    let type: "checking" | "savings" | "credit" = opts.type;
    let balance: number = parseFloat(opts.balance);

    if (!name) {
      name = await input({ message: "Account name:" });
    }

    if (!type) {
      type = await select({
        message: "Account type:",
        choices: [
          { value: "checking" as const, name: "Checking" },
          { value: "savings" as const, name: "Savings" },
          { value: "credit" as const, name: "Credit" },
        ],
      });
    }

    const allowedTypes = ["checking", "savings", "credit"];
    if (!allowedTypes.includes(type)) {
      console.error(chalk.red(`Error: Invalid account type "${type}". Must be one of: checking, savings, credit`));
      process.exit(1);
    }

    if (isNaN(balance)) {
      const balanceInput = await number({ message: "Starting balance:", default: 0 });
      balance = balanceInput ?? 0;
    }

    const account = {
      id: nanoid(),
      name,
      type: type as "checking" | "savings" | "credit",
      startingBalance: balance,
      currency: "USD",
      createdAt: new Date().toISOString(),
    };

    const accounts = readAccounts();
    accounts.push(account);
    writeJsonFile(getFilePath(ACCOUNTS_FILE), accounts);

    console.log(chalk.green(`✓ Account created:`));
    console.log(`  Name:    ${account.name}`);
    console.log(`  Type:    ${account.type}`);
    console.log(`  Balance: ${formatBalance(account.startingBalance)}`);
    console.log(`  ID:      ${account.id}`);
  });

const listCmd = new Command("list")
  .description("List all accounts")
  .action(() => {
    ensureInitialized();

    const accounts = readAccounts();
    const transactions = readTransactions();

    if (accounts.length === 0) {
      console.log(chalk.yellow("No accounts found. Use 'fin account add' to create one."));
      return;
    }

    const nameWidth = Math.max(4, ...accounts.map((a) => a.name.length));
    const typeWidth = 8;

    console.log(
      chalk.bold(
        `${"Name".padEnd(nameWidth)}  ${"Type".padEnd(typeWidth)}  ${"Starting".padStart(12)}  ${"Current".padStart(12)}`
      )
    );
    console.log("─".repeat(nameWidth + typeWidth + 30));

    for (const account of accounts) {
      const txSum = transactions
        .filter((t) => t.accountId === account.id)
        .reduce((sum, t) => sum + t.amount, 0);
      const currentBalance = account.startingBalance + txSum;

      const currentStr = formatBalance(currentBalance);
      const startingStr = formatBalance(account.startingBalance);

      const coloredCurrent =
        currentBalance >= 0 ? chalk.green(currentStr) : chalk.red(currentStr);

      console.log(
        `${account.name.padEnd(nameWidth)}  ${account.type.padEnd(typeWidth)}  ${startingStr.padStart(12)}  ${coloredCurrent.padStart(12 + (coloredCurrent.length - currentStr.length))}`
      );
    }
  });

const removeCmd = new Command("remove")
  .description("Remove an account")
  .option("--name <name>", "Account name")
  .option("--id <id>", "Account ID")
  .option("--force", "Force removal even if account has transactions")
  .action((opts) => {
    ensureInitialized();

    if (!opts.name && !opts.id) {
      console.error(chalk.red("Error: Provide --name or --id to identify the account to remove."));
      process.exit(1);
    }

    const accounts = readAccounts();
    const account = opts.id
      ? accounts.find((a) => a.id === opts.id)
      : accounts.find((a) => a.name === opts.name);

    if (!account) {
      console.error(chalk.red(`Error: Account not found.`));
      process.exit(1);
    }

    const transactions = readTransactions();
    const linked = transactions.filter((t) => t.accountId === account.id);

    if (linked.length > 0 && !opts.force) {
      console.warn(
        chalk.yellow(
          `Warning: Account "${account.name}" has ${linked.length} associated transaction(s). Use --force to remove anyway.`
        )
      );
      process.exit(1);
    }

    const updated = accounts.filter((a) => a.id !== account.id);
    writeJsonFile(getFilePath(ACCOUNTS_FILE), updated);

    console.log(chalk.green(`✓ Account "${account.name}" removed.`));
    if (linked.length > 0) {
      console.log(chalk.yellow(`  ${linked.length} transaction(s) are now orphaned but preserved.`));
    }
  });

function formatBalance(amount: number): string {
  const formatted = Math.abs(amount).toFixed(2);
  return amount < 0 ? `-$${formatted}` : `$${formatted}`;
}

export const accountCommand = new Command("account")
  .description("Manage accounts")
  .addCommand(addCmd)
  .addCommand(listCmd)
  .addCommand(removeCmd);
