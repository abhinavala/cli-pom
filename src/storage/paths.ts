import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

export function getDataDir(): string {
  return process.env["FIN_DATA_DIR"] ?? join(homedir(), ".fin");
}

export function ensureDataDir(): void {
  mkdirSync(getDataDir(), { recursive: true });
}

export function getFilePath(filename: string): string {
  return join(getDataDir(), filename);
}
