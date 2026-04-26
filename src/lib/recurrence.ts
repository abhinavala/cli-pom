import { createRequire } from "node:module";
import type { RRule as RRuleType, rrulestr as RRuleStrFn } from "rrule";
const _require = createRequire(import.meta.url);
const { RRule, rrulestr } = _require("rrule") as {
  RRule: typeof RRuleType;
  rrulestr: typeof RRuleStrFn;
};
import { nanoid } from "nanoid";
import { readJsonFile, writeJsonFile, getFilePath } from "../storage/index.js";
import { RecurringRuleSchema, TransactionSchema } from "../schemas.js";
import type { RecurringRule, Transaction } from "../schemas.js";
import { z } from "zod";

const RULES_FILE = "rules.json";
const TRANSACTIONS_FILE = "transactions.json";

export type FrequencyType = "monthly" | "weekly" | "biweekly" | "yearly" | "custom";
export type VirtualTransaction = Omit<Transaction, "id" | "createdAt">;

function dateToUtc(dateStr: string): Date {
  const parts = dateStr.split("-").map(Number);
  return new Date(Date.UTC(parts[0]!, parts[1]! - 1, parts[2]!));
}

function utcToDateStr(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Converts friendly frequency parameters to an RRULE string.
 * For "custom" frequency, callers should pass the raw RRULE string directly.
 */
export function buildRRule(
  frequency: FrequencyType,
  day: number | undefined,
  start: string,
  end?: string
): string {
  if (frequency === "custom") {
    throw new Error("Pass raw rrule string directly for custom frequency");
  }

  const weekdays = [RRule.MO, RRule.TU, RRule.WE, RRule.TH, RRule.FR, RRule.SA, RRule.SU];
  const dtstart = dateToUtc(start);

  const opts: ConstructorParameters<typeof RRule>[0] = { dtstart };
  if (end) opts.until = dateToUtc(end);

  switch (frequency) {
    case "monthly":
      opts.freq = RRule.MONTHLY;
      if (day !== undefined) opts.bymonthday = day;
      break;
    case "weekly":
      opts.freq = RRule.WEEKLY;
      if (day !== undefined) opts.byweekday = [weekdays[day % 7]!];
      break;
    case "biweekly":
      opts.freq = RRule.WEEKLY;
      opts.interval = 2;
      if (day !== undefined) opts.byweekday = [weekdays[day % 7]!];
      break;
    case "yearly":
      opts.freq = RRule.YEARLY;
      break;
  }

  return new RRule(opts).toString();
}

/**
 * Expands a RecurringRule into virtual (non-persisted) transactions for the
 * given date range. Dates on or before lastMaterializedDate are skipped to
 * prevent duplicates with already-persisted transactions.
 */
export function expandRule(
  rule: RecurringRule,
  fromDate: string,
  toDate: string
): VirtualTransaction[] {
  let effectiveFrom = fromDate;

  if (rule.lastMaterializedDate && rule.lastMaterializedDate >= effectiveFrom) {
    const nextMs = dateToUtc(rule.lastMaterializedDate).getTime() + 86400000;
    effectiveFrom = utcToDateStr(new Date(nextMs));
  }

  if (effectiveFrom > toDate) return [];

  const rr = rrulestr(rule.rrule);
  const dates = rr.between(dateToUtc(effectiveFrom), dateToUtc(toDate), true);

  return dates.map((date) => ({
    accountId: rule.accountId,
    amount: rule.amount,
    category: rule.category,
    description: rule.description,
    date: utcToDateStr(date),
    ruleId: rule.id,
  }));
}

/**
 * Returns all virtual (projected) transactions from all rules for the given
 * date range, sorted by date. Already-materialized occurrences are excluded.
 * These transactions are NOT persisted.
 */
export function projectTransactions(
  fromDate: string,
  toDate: string
): VirtualTransaction[] {
  const rules = readJsonFile(getFilePath(RULES_FILE), z.array(RecurringRuleSchema));
  const all: VirtualTransaction[] = [];

  for (const rule of rules) {
    all.push(...expandRule(rule, fromDate, toDate));
  }

  return all.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * For each rule, materializes all occurrences from lastMaterializedDate
 * through throughDate into real Transaction records (with IDs, ruleId
 * back-ref). Updates each rule's lastMaterializedDate. Returns count of
 * newly created transactions.
 */
export function materializeTransactions(throughDate: string): number {
  const rules = readJsonFile(getFilePath(RULES_FILE), z.array(RecurringRuleSchema));
  const transactions = readJsonFile(getFilePath(TRANSACTIONS_FILE), z.array(TransactionSchema));
  const updatedRules = rules.map((r) => ({ ...r }));
  const now = new Date().toISOString();
  let count = 0;

  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i]!;
    const fromDate = rule.lastMaterializedDate
      ? utcToDateStr(new Date(dateToUtc(rule.lastMaterializedDate).getTime() + 86400000))
      : rule.startDate;

    if (fromDate > throughDate) continue;

    const rr = rrulestr(rule.rrule);
    const dates = rr.between(dateToUtc(fromDate), dateToUtc(throughDate), true);

    for (const date of dates) {
      transactions.push({
        id: nanoid(),
        accountId: rule.accountId,
        amount: rule.amount,
        category: rule.category,
        description: rule.description,
        date: utcToDateStr(date),
        ruleId: rule.id,
        createdAt: now,
      });
      count++;
    }

    if (dates.length > 0) {
      updatedRules[i]!.lastMaterializedDate = utcToDateStr(dates[dates.length - 1]!);
    }
  }

  if (count > 0) {
    writeJsonFile(getFilePath(TRANSACTIONS_FILE), transactions);
    writeJsonFile(getFilePath(RULES_FILE), updatedRules);
  }

  return count;
}
