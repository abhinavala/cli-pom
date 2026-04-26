#!/usr/bin/env node
import { Command } from "commander";
import { ensureInitialized } from "./storage/index.js";
import { createRequire } from "node:module";
import { accountCommand } from "./commands/account.js";
import { txCommand } from "./commands/tx.js";
import { budgetCommand } from "./commands/budget.js";
import { ruleCommand } from "./commands/rule.js";
import { importCommand } from "./commands/import.js";
import { reportCommand } from "./commands/report.js";
import { exportCommand } from "./commands/export.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

const program = new Command();

program
  .name("fin")
  .description("Personal Finance Tracker CLI")
  .version(pkg.version);

program.addCommand(accountCommand);
program.addCommand(txCommand);
program.addCommand(budgetCommand);
program.addCommand(ruleCommand);
program.addCommand(importCommand);
program.addCommand(reportCommand);
program.addCommand(exportCommand);

// Run bootstrap before any command
program.hook("preAction", () => {
  ensureInitialized();
});

program.parse(process.argv);
