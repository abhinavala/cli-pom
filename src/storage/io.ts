import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { z } from "zod";

export function writeJsonFile<T>(filePath: string, data: T): void {
  const tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8");
  renameSync(tmpPath, filePath);
}

export function readJsonFile<T>(filePath: string, schema: z.ZodType<T>): T {
  if (!existsSync(filePath)) {
    return schema.parse(getDefault(schema));
  }
  const raw = readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(raw);
  return schema.parse(parsed);
}

function getDefault(schema: z.ZodTypeAny): unknown {
  if (schema instanceof z.ZodArray) {
    return [];
  }
  if (schema instanceof z.ZodObject) {
    return {};
  }
  return undefined;
}
