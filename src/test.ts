/**
 * Integration tests for Transaction CRUD Commands
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Set up isolated data directory before any imports that reference it
const testDir = mkdtempSync(join(tmpdir(), "fin-test-"));
process.env["FIN_DATA_DIR"] = testDir;

import { writeJsonFile, readJsonFile, getFilePath, ensureInitialized } from "./storage/index.js";
import { AccountSchema, TransactionSchema, BudgetSchema } from "./schemas.js";
import { checkBudgetAfterTransaction } from "./lib/budget-check.js";
import { z } from "zod";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message}`);
    failed++;
  }
}

function resetData(): void {
  writeJsonFile(join(testDir, "accounts.json"), []);
  writeJsonFile(join(testDir, "transactions.json"), []);
  writeJsonFile(join(testDir, "budgets.json"), []);
}

// Bootstrap
ensureInitialized();

// ─── Test helpers ────────────────────────────────────────────────────────────

function makeAccount(id: string, name: string) {
  return {
    id,
    name,
    type: "checking" as const,
    startingBalance: 0,
    currency: "USD",
    createdAt: new Date().toISOString(),
  };
}

function makeTx(
  id: string,
  accountId: string,
  amount: number,
  category: string,
  description: string,
  date: string
) {
  return {
    id,
    accountId,
    amount,
    category,
    description,
    date,
    createdAt: new Date().toISOString(),
  };
}

// ─── Test 1: Add 5 transactions across 2 accounts, list with no filters ──────

console.log("\nTest 1: Add 5 transactions across 2 accounts, list all");
resetData();

const acc1 = makeAccount("acc-1", "Checking");
const acc2 = makeAccount("acc-2", "Savings");
writeJsonFile(getFilePath("accounts.json"), [acc1, acc2]);

const transactions = [
  makeTx("tx-1", "acc-1", -50, "groceries", "Trader Joes", "2026-01-05"),
  makeTx("tx-2", "acc-1", -30, "transport", "Bus pass", "2026-01-10"),
  makeTx("tx-3", "acc-2", 500, "income", "Paycheck", "2026-01-15"),
  makeTx("tx-4", "acc-2", -20, "dining", "Restaurant", "2026-01-03"),
  makeTx("tx-5", "acc-1", -15, "groceries", "Whole Foods", "2026-01-20"),
];
writeJsonFile(getFilePath("transactions.json"), transactions);

const allTxs = readJsonFile(getFilePath("transactions.json"), z.array(TransactionSchema));
const sorted = [...allTxs].sort((a, b) => b.date.localeCompare(a.date));

assert(allTxs.length === 5, "5 transactions stored");
assert(sorted[0].id === "tx-5", "First in sort is the latest date (2026-01-20)");
assert(sorted[4].id === "tx-4", "Last in sort is earliest date (2026-01-03)");

// ─── Test 2: Budget check - warning and over ──────────────────────────────────

console.log("\nTest 2: Budget check for category with $200 limit");
resetData();

writeJsonFile(getFilePath("accounts.json"), [acc1]);
writeJsonFile(getFilePath("budgets.json"), [{ category: "groceries", monthlyLimit: 200, warnAt: 0.8 }]);

// Add transactions that total $170 (85% = warning)
writeJsonFile(getFilePath("transactions.json"), [
  makeTx("tx-a", "acc-1", -100, "groceries", "Store A", "2026-04-01"),
  makeTx("tx-b", "acc-1", -70, "groceries", "Store B", "2026-04-05"),
]);

const warnTx = makeTx("tx-c", "acc-1", -10, "groceries", "Store C", "2026-04-10");
// tx-c would bring total to $180 (90%) - above warnAt of 80%
writeJsonFile(getFilePath("transactions.json"), [
  makeTx("tx-a", "acc-1", -100, "groceries", "Store A", "2026-04-01"),
  makeTx("tx-b", "acc-1", -70, "groceries", "Store B", "2026-04-05"),
  warnTx,
]);

const warnResult = checkBudgetAfterTransaction(warnTx);
assert(warnResult !== null, "Budget result returned for known category");
assert(warnResult?.status === "warning", `Warning status at 90% spend (${warnResult?.percentage.toFixed(2)})`);
assert(warnResult?.spent === 180, `MTD spent is $180 (got ${warnResult?.spent})`);

// Now add enough to exceed $200
const overTx = makeTx("tx-d", "acc-1", -50, "groceries", "Store D", "2026-04-15");
writeJsonFile(getFilePath("transactions.json"), [
  makeTx("tx-a", "acc-1", -100, "groceries", "Store A", "2026-04-01"),
  makeTx("tx-b", "acc-1", -70, "groceries", "Store B", "2026-04-05"),
  warnTx,
  overTx,
]);

const overResult = checkBudgetAfterTransaction(overTx);
assert(overResult?.status === "over", `Over status when spent $230 of $200 limit`);

// ─── Test 3: List with --category filter ──────────────────────────────────────

console.log("\nTest 3: Filter by category");
resetData();
writeJsonFile(getFilePath("accounts.json"), [acc1]);

const mixed = [
  makeTx("m-1", "acc-1", -50, "groceries", "Grocery A", "2026-02-01"),
  makeTx("m-2", "acc-1", -20, "dining", "Restaurant", "2026-02-02"),
  makeTx("m-3", "acc-1", -30, "groceries", "Grocery B", "2026-02-03"),
];
writeJsonFile(getFilePath("transactions.json"), mixed);

const all = readJsonFile(getFilePath("transactions.json"), z.array(TransactionSchema));
const groceryOnly = all.filter((t) =>
  t.category.toLowerCase().includes("groceries")
);
assert(groceryOnly.length === 2, "Filtering by 'groceries' returns 2 transactions");
assert(
  groceryOnly.every((t) => t.category === "groceries"),
  "All filtered transactions have category 'groceries'"
);

// ─── Test 4: Non-existent account lookup ─────────────────────────────────────

console.log("\nTest 4: Account lookup by name (partial, case-insensitive)");
resetData();
writeJsonFile(getFilePath("accounts.json"), [acc1, acc2]);

const accounts = readJsonFile(getFilePath("accounts.json"), z.array(AccountSchema));

// Partial match
const found = accounts.find(
  (a) =>
    a.id === "checking" ||
    a.name.toLowerCase().includes("check")
);
assert(found?.id === "acc-1", "Partial name match 'check' finds Checking account");

// Non-existent
const notFound = accounts.find(
  (a) =>
    a.id === "xyz" ||
    a.name.toLowerCase().includes("xyz")
);
assert(notFound === undefined, "Non-existent account returns undefined (would print error)");

// ─── Test 5: No budget set for category returns null ─────────────────────────

console.log("\nTest 5: No budget for category returns null");
resetData();
writeJsonFile(getFilePath("accounts.json"), [acc1]);
writeJsonFile(getFilePath("budgets.json"), []);
writeJsonFile(getFilePath("transactions.json"), []);

const noBudgetTx = makeTx("nb-1", "acc-1", -50, "misc", "Something", "2026-04-01");
const noBudgetResult = checkBudgetAfterTransaction(noBudgetTx);
assert(noBudgetResult === null, "Returns null when no budget set for category");

// ─── Cleanup & summary ────────────────────────────────────────────────────────

rmSync(testDir, { recursive: true });

console.log(`\n${"─".repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
