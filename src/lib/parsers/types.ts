import type { Transaction } from "../../schemas.js";

export interface BankParser {
  detect(headers: string[]): boolean;
  parse(row: Record<string, string>, accountId: string): Transaction;
}
