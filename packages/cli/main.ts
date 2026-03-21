/**
 * The main starting point for the application
 */

import { executeCommands } from "./commands/index.ts";
import { parseCliFlags } from "./flags.ts";
import {
  ApplyCliOverrides,
  FlushLogfileIfExists,
  GenerateDocs,
  GetAllRules,
  GetConfig,
  LoadWorkspace,
  resetLogfile,
  SaveConfig,
  setColorsEnabled,
} from "@d2rlint/lib";

// Import all rules so that they get registered via @lintrule.
import "@d2rlint/lib/rules";

// ---------------------------------------------------------------------------
// Flag parsing
// ---------------------------------------------------------------------------

const { overrides, positionalArgs, save } = parseCliFlags(Deno.args);

// ---------------------------------------------------------------------------
// Config + workspace
// ---------------------------------------------------------------------------

// Load config then apply overrides before workspace loading, so workspace/
// fallback/version flags are visible to LoadWorkspace.
const config = GetConfig();
ApplyCliOverrides(config, overrides);

// Apply color setting before any colored output is produced.
// "auto" detects support via terminal env vars; true/false force the setting.
function supportsColor(): boolean {
  if (!Deno.stdout.isTerminal()) return false;
  if (Deno.env.get("COLORTERM")) return true;
  if (Deno.env.get("TERM_PROGRAM")) return true;
  if (Deno.env.get("WT_SESSION")) return true;
  return false;
}
const useColor = config.color === "auto" ? supportsColor() : config.color;
setColorsEnabled(useColor);

const { workspace, fallback, rules, version } = config;

// ---------------------------------------------------------------------------
// Build the list of lint runs. When `runs` is non-empty, each entry defines
// its own workspace / fallback / log / exclude. Otherwise fall back to the
// single top-level workspace / fallback / log (original behaviour).
// ---------------------------------------------------------------------------

interface LintRun {
  workspace: string;
  fallback: string;
  log: string;
  exclude: string[];
}

const lintRuns: LintRun[] = config.runs.length > 0
  ? config.runs
  : [{ workspace, fallback, log: config.log, exclude: [] }];

// For command dispatch we use the first run's workspace (commands are not
// per-run — they just need *a* workspace).
const firstRun = lintRuns[0];
const commandWs = LoadWorkspace(
  firstRun.workspace,
  firstRun.fallback,
  version,
  firstRun.exclude,
);

// ---------------------------------------------------------------------------
// Command dispatch
// ---------------------------------------------------------------------------

if (positionalArgs.length > 0) {
  if (!executeCommands(positionalArgs, commandWs)) {
    console.error(
      `ERROR: A command by that name (${positionalArgs[0]}) does not exist.`,
    );
  }
  FlushLogfileIfExists();
  if (save) {
    SaveConfig(config, "config.json");
    console.log("Config saved to config.json");
  }
  Deno.exit(0);
}

// ---------------------------------------------------------------------------
// Donation banner (shown only for normal lint runs, not commands or --help)
// ---------------------------------------------------------------------------

if (!config.iveConsideredDonating) {
  console.log(`-----------------------------------------`);
  console.log(`| d2rlint is always available for free, |`);
  console.log(`| but it takes many man-hours to main-  |`);
  console.log(`| -tain it and produce new features for |`);
  console.log(`| all mod-makers to use.                |`);
  console.log(`|                                       |`);
  console.log(`| Please consider making a direct do-   |`);
  console.log(`| -nation, or sponsoring me on Patreon: |`);
  console.log(`| https://www.patreon.com/eezstreet     |`);
  console.log(`|                                       |`);
  console.log(`| Alternatively, change the following   |`);
  console.log(`| value in your config.json to be true: |`);
  console.log(`|   iveConsideredDonating: "false",     |`);
  console.log(`-----------------------------------------`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pressEnterToContinue(msg: string): void {
  console.log(msg);
  Deno.stdin.readSync(new Uint8Array(32));
}

// ---------------------------------------------------------------------------
// Rule evaluation — iterate over all configured lint runs
// ---------------------------------------------------------------------------

const allRules = GetAllRules();
for (const run of lintRuns) {
  // Override config.log so the LogFile singleton writes to the right place
  config.log = run.log;
  resetLogfile();

  console.log(`\n--- Lint run: ${run.workspace} → ${run.log} ---`);
  const ws = LoadWorkspace(run.workspace, run.fallback, version, run.exclude);

  for (const rule of allRules) {
    if (rules[rule.GetRuleName()]?.action !== "ignore") {
      rule.Evaluate(ws);
    }
  }

  FlushLogfileIfExists();
}

pressEnterToContinue("Checking complete. Press enter to continue...");

// ---------------------------------------------------------------------------
// Doc generation (uses first run's workspace)
// ---------------------------------------------------------------------------

if (config.generateDocs === true) {
  GenerateDocs(commandWs);
  pressEnterToContinue("Docs generated. Press enter to continue...");
}

// ---------------------------------------------------------------------------
// --save
// ---------------------------------------------------------------------------

// Restore log to original value before saving so the config file is clean
config.log = lintRuns.length === 1 && config.runs.length === 0
  ? lintRuns[0].log
  : config.log;

if (save) {
  SaveConfig(config, "config.json");
  console.log("Config saved to config.json");
}

Deno.exit(0);
