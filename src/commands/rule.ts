import { Command } from "commander";
import { nanoid } from "nanoid";
import chalk from "chalk";
import { input, select, number as inquirerNumber } from "@inquirer/prompts";
import { readJsonFile, writeJsonFile, getFilePath, ensureInitialized } from "../storage/index.js";
import { AccountSchema, RecurringRuleSchema } from "../schemas.js";
import { z } from "zod";
import { buildRRule, materializeTransactions, type FrequencyType } from "../lib/recurrence.js";
import { createRequire } from "node:module";
import type { rrulestr as RRuleStrFn } from "rrule";
const _require = createRequire(import.meta.url);
const { rrulestr } = _require("rrule") as { rrulestr: typeof RRuleStrFn };

const ACCOUNTS_FILE = "accounts.json";
const RULES_FILE = "rules.json";

const VALID_FREQUENCIES = ["monthly", "weekly", "biweekly", "yearly", "custom"] as const;

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]!);
}

const DAY_NAMES: Record<string, string> = {
  MO: "Monday",
  TU: "Tuesday",
  WE: "Wednesday",
  TH: "Thursday",
  FR: "Friday",
  SA: "Saturday",
  SU: "Sunday",
};

function humanReadableSchedule(rruleStr: string): string {
  const upper = rruleStr.toUpperCase();
  const freqMatch = upper.match(/FREQ=(\w+)/);
  const intervalMatch = upper.match(/INTERVAL=(\d+)/);
  const bymonthdayMatch = upper.match(/BYMONTHDAY=(-?\d+)/);
  const bydayMatch = upper.match(/BYDAY=([A-Z0-9,+\-]+)/);

  const freq = freqMatch?.[1] ?? "";
  const interval = intervalMatch ? parseInt(intervalMatch[1]!, 10) : 1;

  if (freq === "MONTHLY") {
    if (bymonthdayMatch) {
      const day = parseInt(bymonthdayMatch[1]!, 10);
      return `Monthly on the ${ordinal(day)}`;
    }
    return "Monthly";
  }

  if (freq === "WEEKLY") {
    let dayStr = "";
    if (bydayMatch) {
      const firstDay = bydayMatch[1]!.replace(/[^A-Z,]/g, "").split(",")[0] ?? "";
      if (firstDay in DAY_NAMES) dayStr = ` on ${DAY_NAMES[firstDay]}`;
    }
    if (interval === 2) return `Every 2 weeks${dayStr}`;
    return `Weekly${dayStr}`;
  }

  if (freq === "YEARLY") return "Yearly";
  if (freq === "DAILY") return interval > 1 ? `Every ${interval} days` : "Daily";

  // Fallback: extract the RRULE line content
  return upper.split("\n").find((l) => l.startsWith("RRULE:"))?.replace("RRULE:", "") ?? rruleStr;
}

function nextOccurrence(rruleStr: string): string | null {
  try {
    const rule = rrulestr(rruleStr);
    const today = new Date();
    const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const next = rule.after(todayUtc, true);
    return next ? next.toISOString().slice(0, 10) : null;
  } catch {
    return null;
  }
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
  .description("Add a new recurring rule")
  .option("--account <account>", "Account name or ID")
  .option("--amount <amount>", "Amount (positive for income, negative for expenses)")
  .option("--category <category>", "Category")
  .option("--description <description>", "Description")
  .option("--frequency <frequency>", "Frequency (monthly|weekly|biweekly|yearly|custom)")
  .option("--day <day>", "Day of month (1-31) for monthly, day of week (0=Mon..6=Sun) for weekly/biweekly")
  .option("--start <start>", "Start date (ISO format, defaults to today)")
  .option("--end <end>", "End date (ISO format, optional)")
  .option("--rrule <rrule>", "Raw RRULE string (only for --frequency custom)")
  .action(async (opts) => {
    ensureInitialized();

    const accounts = readJsonFile(getFilePath(ACCOUNTS_FILE), z.array(AccountSchema));

    // Account
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
      const v = await inquirerNumber({ message: "Amount (positive=income, negative=expense):" });
      amount = v ?? 0;
    }

    // Category
    let category: string = opts.category;
    if (!category) category = await input({ message: "Category:" });

    // Description
    let description: string = opts.description;
    if (!description) description = await input({ message: "Description:" });

    // Frequency
    let frequencyStr: string = opts.frequency ?? "";
    if (!frequencyStr) {
      frequencyStr = await select({
        message: "Frequency:",
        choices: VALID_FREQUENCIES.map((f) => ({ value: f, name: f })),
      });
    }
    if (!VALID_FREQUENCIES.includes(frequencyStr as FrequencyType)) {
      console.error(chalk.red(`Error: Invalid frequency "${frequencyStr}". Must be one of: ${VALID_FREQUENCIES.join(", ")}`));
      process.exit(1);
    }
    const frequency = frequencyStr as FrequencyType;

    // Start date
    const start: string = opts.start ?? new Date().toISOString().slice(0, 10);

    // End date (optional)
    const end: string | undefined = opts.end;

    // Build RRULE
    let rruleStr: string;
    if (frequency === "custom") {
      rruleStr = opts.rrule;
      if (!rruleStr) {
        rruleStr = await input({ message: "RRULE string (e.g. FREQ=WEEKLY;INTERVAL=2;BYDAY=FR):" });
      }
    } else {
      let day: number | undefined =
        opts.day !== undefined ? parseInt(opts.day, 10) : undefined;

      if (day === undefined && (frequency === "monthly" || frequency === "weekly" || frequency === "biweekly")) {
        if (frequency === "monthly") {
          const v = await inquirerNumber({ message: "Day of month (1-31):", default: 1 });
          day = v ?? 1;
        } else {
          const v = await inquirerNumber({
            message: "Day of week (0=Mon, 1=Tue, 2=Wed, 3=Thu, 4=Fri, 5=Sat, 6=Sun):",
            default: 0,
          });
          day = v ?? 0;
        }
      }

      try {
        rruleStr = buildRRule(frequency, day, start, end);
      } catch (err) {
        console.error(chalk.red(`Error building RRULE: ${(err as Error).message}`));
        process.exit(1);
      }
    }

    const rule = {
      id: nanoid(),
      accountId: account.id,
      amount,
      category,
      description,
      rrule: rruleStr,
      startDate: start,
      endDate: end,
    };

    const rules = readJsonFile(getFilePath(RULES_FILE), z.array(RecurringRuleSchema));
    rules.push(rule);
    writeJsonFile(getFilePath(RULES_FILE), rules);

    console.log(chalk.green("✓ Recurring rule created:"));
    console.log(`  ID:          ${rule.id}`);
    console.log(`  Account:     ${account.name}`);
    console.log(`  Amount:      ${colorAmount(amount)}`);
    console.log(`  Category:    ${category}`);
    console.log(`  Description: ${description}`);
    console.log(`  Schedule:    ${humanReadableSchedule(rruleStr)}`);
    console.log(`  Next:        ${nextOccurrence(rruleStr) ?? "N/A"}`);
  });

const listCmd = new Command("list")
  .description("List all recurring rules")
  .action(() => {
    ensureInitialized();

    const accounts = readJsonFile(getFilePath(ACCOUNTS_FILE), z.array(AccountSchema));
    const rules = readJsonFile(getFilePath(RULES_FILE), z.array(RecurringRuleSchema));

    if (rules.length === 0) {
      console.log(chalk.yellow("No recurring rules found. Use 'fin rule add' to create one."));
      return;
    }

    const accountMap = new Map(accounts.map((a) => [a.id, a.name]));

    const idWidth = 8;
    const descWidth = 20;
    const amtWidth = 12;
    const schedWidth = 26;
    const nextWidth = 12;

    console.log(
      chalk.bold(
        `${"ID".padEnd(idWidth)}  ${"Description".padEnd(descWidth)}  ${"Amount".padStart(amtWidth)}  ${"Schedule".padEnd(schedWidth)}  ${"Next".padEnd(nextWidth)}  Account`
      )
    );
    console.log("─".repeat(idWidth + descWidth + amtWidth + schedWidth + nextWidth + 24));

    for (const rule of rules) {
      const accName = accountMap.get(rule.accountId) ?? rule.accountId;
      const desc =
        rule.description.length > descWidth
          ? rule.description.slice(0, descWidth - 1) + "…"
          : rule.description;
      const schedule = humanReadableSchedule(rule.rrule);
      const schedStr =
        schedule.length > schedWidth
          ? schedule.slice(0, schedWidth - 1) + "…"
          : schedule;
      const next = nextOccurrence(rule.rrule) ?? "N/A";
      const amtStr = formatAmount(rule.amount);
      const coloredAmt = colorAmount(rule.amount);
      const amtPad = amtWidth + (coloredAmt.length - amtStr.length);

      console.log(
        `${rule.id.slice(0, idWidth).padEnd(idWidth)}  ${desc.padEnd(descWidth)}  ${coloredAmt.padStart(amtPad)}  ${schedStr.padEnd(schedWidth)}  ${next.padEnd(nextWidth)}  ${accName}`
      );
    }
  });

const removeCmd = new Command("remove")
  .description("Remove a recurring rule by ID")
  .option("--id <id>", "Rule ID")
  .action((opts) => {
    ensureInitialized();

    if (!opts.id) {
      console.error(chalk.red("Error: --id is required"));
      process.exit(1);
    }

    const rules = readJsonFile(getFilePath(RULES_FILE), z.array(RecurringRuleSchema));
    const idx = rules.findIndex((r) => r.id === opts.id);

    if (idx === -1) {
      console.error(chalk.red(`Error: Rule not found: "${opts.id}"`));
      process.exit(1);
    }

    const [removed] = rules.splice(idx, 1);
    writeJsonFile(getFilePath(RULES_FILE), rules);

    console.log(chalk.green("✓ Rule removed:"));
    console.log(`  ID:          ${removed!.id}`);
    console.log(`  Description: ${removed!.description}`);
    console.log(`  Schedule:    ${humanReadableSchedule(removed!.rrule)}`);
  });

const materializeCmd = new Command("materialize")
  .description("Materialize recurring transactions through today")
  .action(() => {
    ensureInitialized();

    const today = new Date().toISOString().slice(0, 10);
    const count = materializeTransactions(today);

    if (count === 0) {
      console.log(chalk.yellow("No new transactions to materialize."));
    } else {
      console.log(chalk.green(`✓ Materialized ${count} transaction(s) through ${today}.`));
    }
  });

export const ruleCommand = new Command("rule")
  .description("Manage recurring rules")
  .addCommand(addCmd)
  .addCommand(listCmd)
  .addCommand(removeCmd)
  .addCommand(materializeCmd);

export function registerRuleCommands(program: Command): void {
  program.addCommand(ruleCommand);
}
