import { nanoid } from "nanoid";
import type { Transaction } from "../../schemas.js";
import type { BankParser } from "./types.js";

const CHASE_HEADERS = ["Transaction Date", "Post Date", "Description", "Category", "Type", "Amount", "Memo"];

const CATEGORY_MAP: Record<string, string> = {
  "Food & Drink": "food",
  "Groceries": "groceries",
  "Shopping": "shopping",
  "Travel": "travel",
  "Entertainment": "entertainment",
  "Bills & Utilities": "bills",
  "Health & Wellness": "health",
  "Gas": "gas",
  "Automotive": "automotive",
  "Education": "education",
  "Personal": "personal",
  "Payment": "payment",
  "Transfer": "transfer",
  "ATM": "atm",
  "Fees & Adjustments": "fees",
};

export const chaseParser: BankParser = {
  detect(headers: string[]): boolean {
    return CHASE_HEADERS.every((h) => headers.includes(h));
  },

  parse(row: Record<string, string>, accountId: string): Transaction {
    const rawAmount = parseFloat(row["Amount"] ?? "0");
    // Chase: positive = charge (debit), negative = credit → flip signs
    const amount = -rawAmount;

    const chaseCategory = row["Category"]?.trim() ?? "";
    const category = CATEGORY_MAP[chaseCategory] ?? "uncategorized";

    return {
      id: nanoid(),
      accountId,
      amount,
      category,
      description: row["Description"]?.trim() ?? "",
      date: row["Transaction Date"]?.trim() ?? "",
      notes: row["Memo"]?.trim() || undefined,
      createdAt: new Date().toISOString(),
    };
  },
};
