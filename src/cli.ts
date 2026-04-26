#!/usr/bin/env node
import { Command } from "commander";
import { ensureInitialized } from "./storage/index.js";
import { createRequire } from "node:module";
import { accountCommand } from "./commands/account.js";
import { txCommand } from "./commands/tx.js";
import { exportCommand } from "./commands/export.js";
import { budgetCommand } from "./commands/budget.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

const program = new Command();

program
  .name("fin")
  .description("Personal Finance Tracker CLI")
  .version(pkg.version);

// Subcommand groups
const account = accountCommand;
const tx = txCommand;
const budget = budgetCommand;
const rule = new Command("rule").description("Manage recurring rules");
const importCmd = new Command("import").description("Import transactions");
const report = new Command("report").description("Generate reports");

program.addCommand(account);
program.addCommand(tx);
program.addCommand(budget);
program.addCommand(rule);
program.addCommand(importCmd);
program.addCommand(report);
program.addCommand(exportCommand);

// Run bootstrap before any command
program.hook("preAction", () => {
  ensureInitialized();
});

program.parse(process.argv);
