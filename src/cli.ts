#!/usr/bin/env node
import { Command } from "commander";
import { ensureInitialized } from "./storage/index.js";
import { createRequire } from "node:module";
import { accountCommand } from "./commands/account.js";
import { txCommand } from "./commands/tx.js";
import { reportCommand } from "./commands/report.js";

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
const budget = new Command("budget").description("Manage budgets");
const rule = new Command("rule").description("Manage recurring rules");
const importCmd = new Command("import").description("Import transactions");
const exportCmd = new Command("export").description("Export data");

program.addCommand(account);
program.addCommand(tx);
program.addCommand(budget);
program.addCommand(rule);
program.addCommand(importCmd);
program.addCommand(reportCommand);
program.addCommand(exportCmd);

// Run bootstrap before any command
program.hook("preAction", () => {
  ensureInitialized();
});

program.parse(process.argv);
