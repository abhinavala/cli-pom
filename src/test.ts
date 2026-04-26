import { strict as assert } from "node:assert";
import { chaseParser } from "./lib/parsers/chase.js";
import { bofaParser } from "./lib//parsers/bofa.js";
import { detectParser } from "./lib/parsers/index.js";
import { computeImportHash, findDuplicates, normalizeDescription } from "./lib/dedup.js";
import type { Transaction } from "./schemas.js";

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

if (failed > 0) {
  process.exit(1);
}
