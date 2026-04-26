import { z } from "zod";

export const AccountSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["checking", "savings", "credit"]),
  startingBalance: z.number(),
  currency: z.string().default("USD"),
  createdAt: z.string(),
});
export type Account = z.infer<typeof AccountSchema>;

export const TransactionSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  amount: z.number(),
  category: z.string(),
  description: z.string(),
  date: z.string(),
  notes: z.string().optional(),
  ruleId: z.string().optional(),
  importHash: z.string().optional(),
  createdAt: z.string(),
});
export type Transaction = z.infer<typeof TransactionSchema>;

export const RecurringRuleSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  amount: z.number(),
  category: z.string(),
  description: z.string(),
  rrule: z.string(),
  startDate: z.string(),
  endDate: z.string().optional(),
  lastMaterializedDate: z.string().optional(),
});
export type RecurringRule = z.infer<typeof RecurringRuleSchema>;

export const BudgetSchema = z.object({
  category: z.string(),
  monthlyLimit: z.number(),
  warnAt: z.number().default(0.8),
});
export type Budget = z.infer<typeof BudgetSchema>;

export const MetaSchema = z.object({
  schemaVersion: z.number(),
  createdAt: z.string(),
});
export type Meta = z.infer<typeof MetaSchema>;

export const DataFileSchemas = {
  "accounts.json": z.array(AccountSchema),
  "transactions.json": z.array(TransactionSchema),
  "rules.json": z.array(RecurringRuleSchema),
  "budgets.json": z.array(BudgetSchema),
  "meta.json": MetaSchema,
} as const;

export type DataFileSchemaMap = typeof DataFileSchemas;
