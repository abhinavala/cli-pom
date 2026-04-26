import { nanoid } from "nanoid";
import type { Transaction } from "../../schemas.js";
import type { BankParser } from "./types.js";

const BOFA_HEADERS = ["Date", "Description", "Amount", "Running Bal."];

export const bofaParser: BankParser = {
  detect(headers: string[]): boolean {
    return BOFA_HEADERS.every((h) => headers.includes(h));
  },

  parse(row: Record<string, string>, accountId: string): Transaction {
    // BofA: negative = debit, matches internal convention
    const amount = parseFloat(row["Amount"] ?? "0");

    return {
      id: nanoid(),
      accountId,
      amount,
      category: "uncategorized",
      description: row["Description"]?.trim() ?? "",
      date: row["Date"]?.trim() ?? "",
      createdAt: new Date().toISOString(),
    };
  },
};
