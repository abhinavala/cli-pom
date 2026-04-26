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
import {
  filterTransactions,
  groupByCategory,
  groupByMonth,
  computeAccountBalance,
  computeNetWorth,
} from "./lib/reporting.js";
import { z } from "zod";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${(err as Error).message}`);
    failed++;
  }
}

function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "test-id",
    accountId: "acct-1",
    amount: -50.0,
    category: "food",
    description: "Starbucks",
    date: "2024-01-15",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ---- Parser Tests ----
console.log("\nParser Tests:");

test("Chase parser detects correct headers", () => {
  const headers = ["Transaction Date", "Post Date", "Description", "Category", "Type", "Amount", "Memo"];
  assert.equal(chaseParser.detect(headers), true);
});

test("Chase parser rejects missing headers", () => {
  const headers = ["Date", "Description", "Amount"];
  assert.equal(chaseParser.detect(headers), false);
});

test("Chase parser flips amount signs (positive charge → negative)", () => {
  const row = {
    "Transaction Date": "2024-01-15",
    "Post Date": "2024-01-16",
    "Description": "STARBUCKS",
    "Category": "Food & Drink",
    "Type": "Sale",
    "Amount": "4.50",
    "Memo": "",
  };
  const tx = chaseParser.parse(row, "acct-1");
  assert.equal(tx.amount, -4.50, "Positive charge should become negative");
});

test("Chase parser maps category correctly", () => {
  const row = {
    "Transaction Date": "2024-01-15",
    "Post Date": "2024-01-16",
    "Description": "WHOLE FOODS",
    "Category": "Groceries",
    "Type": "Sale",
    "Amount": "45.00",
    "Memo": "",
  };
  const tx = chaseParser.parse(row, "acct-1");
  assert.equal(tx.category, "groceries");
});

test("Chase parser defaults unmapped category to uncategorized", () => {
  const row = {
    "Transaction Date": "2024-01-15",
    "Post Date": "2024-01-16",
    "Description": "SOME STORE",
    "Category": "Unknown Category",
    "Type": "Sale",
    "Amount": "10.00",
    "Memo": "",
  };
  const tx = chaseParser.parse(row, "acct-1");
  assert.equal(tx.category, "uncategorized");
});

test("BofA parser detects correct headers", () => {
  const headers = ["Date", "Description", "Amount", "Running Bal."];
  assert.equal(bofaParser.detect(headers), true);
});

test("BofA parser defaults category to uncategorized", () => {
  const row = {
    "Date": "01/15/2024",
    "Description": "AMAZON.COM",
    "Amount": "-29.99",
    "Running Bal.": "1000.00",
  };
  const tx = bofaParser.parse(row, "acct-1");
  assert.equal(tx.category, "uncategorized");
  assert.equal(tx.amount, -29.99);
});

test("detectParser returns Chase parser for Chase headers", () => {
  const headers = ["Transaction Date", "Post Date", "Description", "Category", "Type", "Amount", "Memo"];
  const parser = detectParser(headers);
  assert.equal(parser, chaseParser);
});

test("detectParser returns BofA parser for BofA headers", () => {
  const headers = ["Date", "Description", "Amount", "Running Bal."];
  const parser = detectParser(headers);
  assert.equal(parser, bofaParser);
});

test("detectParser throws for unrecognized headers listing supported banks", () => {
  const headers = ["Col1", "Col2", "Col3"];
  assert.throws(
    () => detectParser(headers),
    (err: Error) => {
      assert.ok(err.message.includes("Unrecognized"), `Expected 'Unrecognized' in: ${err.message}`);
      assert.ok(err.message.includes("Chase") || err.message.includes("Bank of America"), `Expected bank names in: ${err.message}`);
      return true;
    }
  );
});

// ---- Dedup Tests ----
console.log("\nDedup Tests:");

test("normalizeDescription strips POS prefix", () => {
  assert.equal(normalizeDescription("POS STARBUCKS"), "starbucks");
});

test("normalizeDescription strips ACH prefix", () => {
  assert.equal(normalizeDescription("ACH PAYMENT"), "payment");
});

test("normalizeDescription strips DEBIT prefix", () => {
  assert.equal(normalizeDescription("DEBIT WALMART"), "walmart");
});

test("normalizeDescription lowercases and trims whitespace", () => {
  assert.equal(normalizeDescription("  Hello   World  "), "hello world");
});

test("computeImportHash returns consistent hash for same inputs", () => {
  const tx = makeTransaction({ date: "2024-01-15", amount: -50.0, description: "Starbucks" });
  const hash1 = computeImportHash(tx);
  const hash2 = computeImportHash(tx);
  assert.equal(hash1, hash2);
});

test("computeImportHash returns different hashes for different transactions", () => {
  const tx1 = makeTransaction({ date: "2024-01-15", amount: -50.0, description: "Starbucks" });
  const tx2 = makeTransaction({ date: "2024-01-15", amount: -51.0, description: "Starbucks" });
  assert.notEqual(computeImportHash(tx1), computeImportHash(tx2));
});

// Test case 1: Import 10 Chase CSV transactions into empty account — all 10 imported
test("findDuplicates: 10 transactions vs empty account → all clean", () => {
  const incoming: Transaction[] = Array.from({ length: 10 }, (_, i) =>
    makeTransaction({
      id: `new-${i}`,
      date: `2024-01-${String(i + 1).padStart(2, "0")}`,
      amount: -(i + 1) * 10,
      description: `Store ${i}`,
      importHash: computeImportHash({
        date: `2024-01-${String(i + 1).padStart(2, "0")}`,
        amount: -(i + 1) * 10,
        description: `Store ${i}`,
      }),
    })
  );

  const result = findDuplicates(incoming, []);
  assert.equal(result.clean.length, 10, `Expected 10 clean, got ${result.clean.length}`);
  assert.equal(result.definite.length, 0);
  assert.equal(result.probable.length, 0);
});

// Test case 2: Import same CSV again → all 10 exact duplicates
test("findDuplicates: 10 transactions vs same 10 existing → all definite duplicates", () => {
  const txns: Transaction[] = Array.from({ length: 10 }, (_, i) => {
    const tx = makeTransaction({
      id: `tx-${i}`,
      date: `2024-01-${String(i + 1).padStart(2, "0")}`,
      amount: -(i + 1) * 10,
      description: `Store ${i}`,
    });
    tx.importHash = computeImportHash(tx);
    return tx;
  });

  const result = findDuplicates(txns, txns);
  assert.equal(result.definite.length, 10, `Expected 10 definite, got ${result.definite.length}`);
  assert.equal(result.clean.length, 0);
  assert.equal(result.probable.length, 0);
});

// Test case 3: Similar transaction (same amount, date +1 day, slightly different description) → probable duplicate
test("findDuplicates: similar transaction (same amount, date +1, slight desc diff) → probable duplicate score > 0.85", () => {
  const existing = makeTransaction({
    id: "exist-1",
    date: "2024-01-15",
    amount: -50.0,
    description: "STARBUCKS COFFEE",
    importHash: computeImportHash({ date: "2024-01-15", amount: -50.0, description: "STARBUCKS COFFEE" }),
  });

  const incoming = makeTransaction({
    id: "new-1",
    date: "2024-01-16", // +1 day
    amount: -50.0,      // same amount
    description: "STARBUCKS COFFE", // slightly different
    importHash: computeImportHash({ date: "2024-01-16", amount: -50.0, description: "STARBUCKS COFFE" }),
  });

  const result = findDuplicates([incoming], [existing]);
  assert.equal(result.probable.length, 1, `Expected 1 probable, got ${result.probable.length}`);
  assert.ok(
    result.probable[0].score > 0.85,
    `Expected score > 0.85, got ${result.probable[0].score}`
  );
  assert.equal(result.clean.length, 0);
  assert.equal(result.definite.length, 0);
});

// Test case 4: Import CSV with unrecognized headers → error
test("detectParser: unrecognized format throws with supported bank list", () => {
  assert.throws(
    () => detectParser(["Foo", "Bar", "Baz"]),
    (err: Error) => {
      assert.ok(
        err.message.toLowerCase().includes("unrecognized") ||
          err.message.toLowerCase().includes("unsupported"),
        `Expected unrecognized error, got: ${err.message}`
      );
      return true;
    }
  );
});

// ---- Summary ----
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);

// ─── Test 5: No budget set for category returns null ─────────────────────────

console.log("\nTest 5: No budget for category returns null");
resetData();
writeJsonFile(getFilePath("accounts.json"), [acc1]);
writeJsonFile(getFilePath("budgets.json"), []);
writeJsonFile(getFilePath("transactions.json"), []);

const noBudgetTx = makeTx("nb-1", "acc-1", -50, "misc", "Something", "2026-04-01");
const noBudgetResult = checkBudgetAfterTransaction(noBudgetTx);
assert(noBudgetResult === null, "Returns null when no budget set for category");

// ─── Test 6: Reporting — spending report with 5 categories ───────────────────

console.log("\nTest 6: Spending report with transactions across 5 categories");
resetData();

writeJsonFile(getFilePath("accounts.json"), [acc1]);
const spendingTxs = [
  makeTx("s-1", "acc-1", -100, "groceries",  "Groceries",  "2026-04-01"),
  makeTx("s-2", "acc-1", -50,  "dining",     "Dinner",     "2026-04-02"),
  makeTx("s-3", "acc-1", -200, "rent",       "Rent",       "2026-04-03"),
  makeTx("s-4", "acc-1", -30,  "transport",  "Bus",        "2026-04-04"),
  makeTx("s-5", "acc-1", -20,  "utilities",  "Electric",   "2026-04-05"),
  makeTx("s-6", "acc-1", 1000, "income",     "Paycheck",   "2026-04-06"),
];
writeJsonFile(getFilePath("transactions.json"), spendingTxs);

const allForSpend = readJsonFile(getFilePath("transactions.json"), z.array(TransactionSchema));
const expenses = allForSpend.filter((t) => t.amount < 0);
const filtered6 = filterTransactions(expenses, { from: "2026-04-01", to: "2026-04-30" });
const byCat = groupByCategory(filtered6);
const sortedCats = [...byCat.entries()].sort((a, b) => Math.abs(b[1].total) - Math.abs(a[1].total));
const totalSpent = filtered6.reduce((s, t) => s + Math.abs(t.amount), 0);
const pctSum = sortedCats.reduce((s, [, v]) => s + (Math.abs(v.total) / totalSpent) * 100, 0);

assert(byCat.size === 5, "5 categories returned from groupByCategory");
assert(sortedCats[0]?.[0] === "rent", "Largest category is rent ($200)");
assert(Math.abs(pctSum - 100) < 0.1, `Percentages sum to ~100% (got ${pctSum.toFixed(2)}%)`);

// ─── Test 7: Reporting — trends with 3 months ────────────────────────────────

console.log("\nTest 7: Trends — month-over-month changes");
resetData();

writeJsonFile(getFilePath("accounts.json"), [acc1]);
const trendTxs = [
  makeTx("t-1", "acc-1", -100, "groceries", "Groceries", "2026-02-10"),
  makeTx("t-2", "acc-1", -80,  "groceries", "Groceries", "2026-03-10"),
  makeTx("t-3", "acc-1", -120, "groceries", "Groceries", "2026-04-10"),
  makeTx("t-4", "acc-1", 500,  "income",    "Paycheck",  "2026-02-01"),
  makeTx("t-5", "acc-1", 500,  "income",    "Paycheck",  "2026-03-01"),
  makeTx("t-6", "acc-1", 500,  "income",    "Paycheck",  "2026-04-01"),
];
writeJsonFile(getFilePath("transactions.json"), trendTxs);

const allForTrend = readJsonFile(getFilePath("transactions.json"), z.array(TransactionSchema));
const febTxs = filterTransactions(allForTrend, { from: "2026-02-01", to: "2026-02-28" });
const marTxs = filterTransactions(allForTrend, { from: "2026-03-01", to: "2026-03-31" });
const aprTxs = filterTransactions(allForTrend, { from: "2026-04-01", to: "2026-04-30" });

const febExp = febTxs.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
const marExp = marTxs.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
const aprExp = aprTxs.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);

assert(febExp === 100, `Feb expenses = $100 (got $${febExp})`);
assert(marExp === 80, `Mar expenses = $80 (got $${marExp})`);
assert(aprExp === 120, `Apr expenses = $120 (got $${aprExp})`);

const marChange = marExp - febExp; // -20 (decrease)
const aprChange = aprExp - marExp; // +40 (increase)
assert(marChange < 0, `Mar vs Feb: spending decreased (▼) (change=${marChange})`);
assert(aprChange > 0, `Apr vs Mar: spending increased (▲) (change=${aprChange})`);

// Month data via groupByMonth
const byMonth = groupByMonth(allForTrend);
assert(byMonth.has("2026-02"), "groupByMonth produces 2026-02 key");
assert(byMonth.has("2026-03"), "groupByMonth produces 2026-03 key");
assert(byMonth.has("2026-04"), "groupByMonth produces 2026-04 key");

// ─── Test 8: Net worth with checking, savings, credit ────────────────────────

console.log("\nTest 8: Net worth — checking $5000, savings $10000, credit -$2000");
resetData();

const checking = {
  id: "nw-checking",
  name: "Checking",
  type: "checking" as const,
  startingBalance: 5000,
  currency: "USD",
  createdAt: new Date().toISOString(),
};
const savings = {
  id: "nw-savings",
  name: "Savings",
  type: "savings" as const,
  startingBalance: 10000,
  currency: "USD",
  createdAt: new Date().toISOString(),
};
const credit = {
  id: "nw-credit",
  name: "Credit Card",
  type: "credit" as const,
  startingBalance: 0,
  currency: "USD",
  createdAt: new Date().toISOString(),
};
writeJsonFile(getFilePath("accounts.json"), [checking, savings, credit]);
writeJsonFile(getFilePath("transactions.json"), [
  makeTx("nw-1", "nw-credit", -2000, "purchases", "Charges", "2026-04-01"),
]);

const checkingBal = computeAccountBalance("nw-checking", "2026-04-30");
const savingsBal = computeAccountBalance("nw-savings", "2026-04-30");
const creditBal = computeAccountBalance("nw-credit", "2026-04-30");
const netWorth = computeNetWorth("2026-04-30");

assert(checkingBal === 5000, `Checking balance = $5000 (got $${checkingBal})`);
assert(savingsBal === 10000, `Savings balance = $10000 (got $${savingsBal})`);
assert(creditBal === -2000, `Credit balance = -$2000 (got $${creditBal})`);
assert(netWorth === 13000, `Net worth = $13000 (got $${netWorth})`);

// ─── Test 9: Report on date range with no transactions ───────────────────────

console.log("\nTest 9: Empty date range — no transactions");
resetData();

writeJsonFile(getFilePath("accounts.json"), [acc1]);
writeJsonFile(getFilePath("transactions.json"), [
  makeTx("e-1", "acc-1", -50, "groceries", "Store", "2026-01-15"),
]);

const allForEmpty = readJsonFile(getFilePath("transactions.json"), z.array(TransactionSchema));
const emptyRange = filterTransactions(allForEmpty, { from: "2026-03-01", to: "2026-03-31" });
assert(emptyRange.length === 0, "No transactions in empty date range");

const emptyBycat = groupByCategory(emptyRange);
assert(emptyBycat.size === 0, "groupByCategory returns empty map for empty input");

const emptyByMonth = groupByMonth(emptyRange);
assert(emptyByMonth.size === 0, "groupByMonth returns empty map for empty input");

// ─── Cleanup & summary ────────────────────────────────────────────────────────

rmSync(testDir, { recursive: true });

console.log(`\n${"─".repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
