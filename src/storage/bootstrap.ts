import { existsSync } from "node:fs";
import { ensureDataDir, getFilePath } from "./paths.js";
import { writeJsonFile } from "./io.js";
import { runMigrations, CURRENT_SCHEMA_VERSION } from "./migrate.js";

const DEFAULT_FILES: Record<string, unknown> = {
  "accounts.json": [],
  "transactions.json": [],
  "rules.json": [],
  "budgets.json": [],
  "meta.json": {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
  },
};

export function ensureInitialized(): void {
  ensureDataDir();

  for (const [filename, defaultData] of Object.entries(DEFAULT_FILES)) {
    const filePath = getFilePath(filename);
    if (!existsSync(filePath)) {
      writeJsonFile(filePath, defaultData);
    }
  }

  runMigrations();
}
