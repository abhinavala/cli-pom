import type { BankParser } from "./types.js";
import { chaseParser } from "./chase.js";
import { bofaParser } from "./bofa.js";

const PARSERS: BankParser[] = [chaseParser, bofaParser];

const SUPPORTED_BANKS = ["Chase", "Bank of America"];

export function detectParser(headers: string[]): BankParser {
  for (const parser of PARSERS) {
    if (parser.detect(headers)) {
      return parser;
    }
  }
  throw new Error(
    `Unrecognized CSV format. Supported banks: ${SUPPORTED_BANKS.join(", ")}`
  );
}

export type { BankParser } from "./types.js";
