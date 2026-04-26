import { copyFileSync, existsSync } from "node:fs";
import { getFilePath } from "./paths.js";
import { readJsonFile, writeJsonFile } from "./io.js";
import { MetaSchema } from "../schemas.js";

export const CURRENT_SCHEMA_VERSION = 1;

interface Migration {
  version: number;
  description: string;
  up: () => void;
}

const migrations: Migration[] = [
  // Future migrations will be added here
  // Example:
  // {
  //   version: 2,
  //   description: "Add field X to accounts",
  //   up: () => { ... }
  // }
];

function backupFile(filename: string): void {
  const src = getFilePath(filename);
  if (existsSync(src)) {
    copyFileSync(src, `${src}.bak`);
  }
}

export function runMigrations(): void {
  const metaPath = getFilePath("meta.json");
  const meta = readJsonFile(metaPath, MetaSchema);
  const currentVersion = meta.schemaVersion ?? 1;

  const pending = migrations.filter((m) => m.version > currentVersion);
  if (pending.length === 0) return;

  // Back up all data files before migrating
  const dataFiles = [
    "accounts.json",
    "transactions.json",
    "rules.json",
    "budgets.json",
    "meta.json",
  ];
  for (const file of dataFiles) {
    backupFile(file);
  }

  for (const migration of pending) {
    migration.up();
    writeJsonFile(metaPath, {
      ...meta,
      schemaVersion: migration.version,
    });
  }

  writeJsonFile(metaPath, {
    ...meta,
    schemaVersion: CURRENT_SCHEMA_VERSION,
  });
}
