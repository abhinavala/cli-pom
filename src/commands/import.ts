import { Command } from "commander";
import { readFileSync } from "node:fs";
import { parse } from "csv-parse/sync";
import chalk from "chalk";
import { confirm } from "@inquirer/prompts";
import { z } from "zod";
import { readJsonFile, writeJsonFile, getFilePath, ensureInitialized } from "../storage/index.js";
import { AccountSchema, TransactionSchema } from "../schemas.js";
import { detectParser } from "../lib/parsers/index.js";
import { computeImportHash, findDuplicates } from "../lib/dedup.js";

const ACCOUNTS_FILE = "accounts.json";
const TRANSACTIONS_FILE = "transactions.json";

function formatAmount(amount: number): string {
  const formatted = Math.abs(amount).toFixed(2);
  return amount < 0 ? `-$${formatted}` : `$${formatted}`;
}

export const importCommand = new Command("import")
  .description("Import transactions from a CSV file")
  .argument("<filepath>", "Path to CSV file")
  .requiredOption("--account <name>", "Account name or ID to import into")
  .option("--dry-run", "Show what would be imported without writing")
  .action(async (filepath: string, opts: { account: string; dryRun?: boolean }) => {
    ensureInitialized();

    const accounts = readJsonFile(getFilePath(ACCOUNTS_FILE), z.array(AccountSchema));
    const account = accounts.find((a) => a.name === opts.account || a.id === opts.account);

    if (!account) {
      console.error(chalk.red(`Error: Account "${opts.account}" not found.`));
      process.exit(1);
    }

    let content: string;
    try {
      content = readFileSync(filepath, "utf-8");
    } catch {
      console.error(chalk.red(`Error: Cannot read file "${filepath}".`));
      process.exit(1);
    }

    // Get headers from first row
    const rawRows = parse(content, { to_line: 1 }) as string[][];
    if (!rawRows.length || !rawRows[0].length) {
      console.error(chalk.red("Error: CSV file is empty or has no headers."));
      process.exit(1);
    }
    const headers = rawRows[0].map((h) => h.trim());

    let parser;
    try {
      parser = detectParser(headers);
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exit(1);
    }

    const records = parse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as Record<string, string>[];

    if (records.length === 0) {
      console.log(chalk.yellow("No transactions found in CSV."));
      return;
    }

    const incoming = records.map((row) => {
      const tx = parser.parse(row, account.id);
      tx.importHash = computeImportHash(tx);
      return tx;
    });

    const allTransactions = readJsonFile(getFilePath(TRANSACTIONS_FILE), z.array(TransactionSchema));
    const existingForAccount = allTransactions.filter((t) => t.accountId === account.id);

    const { definite, probable, clean } = findDuplicates(incoming, existingForAccount);

    if (definite.length > 0) {
      console.log(chalk.yellow(`Skipping ${definite.length} exact duplicate(s)`));
    }

    const toImport = [...clean];

    for (const { incoming: tx, match, score } of probable) {
      const descWidth = 40;
      console.log(chalk.yellow(`\nProbable duplicate (score: ${score.toFixed(2)}):`));
      console.log(
        `  Incoming: ${tx.date}  ${tx.description.substring(0, descWidth).padEnd(descWidth)}  ${formatAmount(tx.amount)}`
      );
      console.log(
        `  Existing: ${match.date}  ${match.description.substring(0, descWidth).padEnd(descWidth)}  ${formatAmount(match.amount)}`
      );

      if (!opts.dryRun) {
        const skip = await confirm({ message: "Skip this?", default: true });
        if (!skip) {
          toImport.push(tx);
        }
      }
    }

    if (opts.dryRun) {
      const dryTotal = clean.length + probable.length;
      console.log(
        chalk.cyan(
          `\nDry run: Would import up to ${dryTotal} transaction(s) (${clean.length} clean, ${probable.length} probable duplicate(s) pending review)`
        )
      );
      for (const tx of [...clean, ...probable.map((p) => p.incoming)]) {
        console.log(`  ${tx.date}  ${tx.description.substring(0, 40).padEnd(40)}  ${formatAmount(tx.amount)}`);
      }
      return;
    }

    if (toImport.length === 0) {
      console.log(chalk.green("Nothing new to import."));
      return;
    }

    const updated = [...allTransactions, ...toImport];
    writeJsonFile(getFilePath(TRANSACTIONS_FILE), updated);

    console.log(chalk.green(`\n✓ Imported ${toImport.length} transaction(s) into "${account.name}".`));
  });

export function registerImportCommand(program: Command): void {
  program.addCommand(importCommand);
}
