import { existsSync, readFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_STATE_PATH } from "./constants.js";
import { parseAgentFile } from "./parser.js";
import { purge, reconcile } from "./reconciler.js";
import { toOpenClawAgent } from "./translator.js";
import type { OpenClawPluginApi, PluginConfig } from "./index.js";

function expandHome(p: string): string {
  if (p.startsWith("~/") || p === "~") return p.replace("~", homedir());
  return p;
}

async function discoverFiles(
  watchDirs: string[],
  patterns: string[],
): Promise<string[]> {
  const results: string[] = [];
  for (const dir of watchDirs) {
    const expanded = expandHome(dir);
    for (const pattern of patterns) {
      try {
        for await (const file of glob(pattern, { cwd: expanded })) {
          results.push(join(expanded, file));
        }
      } catch {
        // directory may not exist yet
      }
    }
  }
  return results;
}

export function registerCli(api: OpenClawPluginApi): void {
  let pluginConfig: PluginConfig = {};
  try {
    pluginConfig = api.getPluginConfig<PluginConfig>("openclaw-canonical-agents");
  } catch {
    // not available outside of plugin context
  }

  const watchDirs = pluginConfig.watchDirs ?? ["~/agents-repo"];
  const filePattern = pluginConfig.filePattern ?? [
    "**/AGENTS.md",
    "**/*.agent.md",
  ];

  api.registerCli({
    name: "openclaw-canonical-agents",
    commands: [
      {
        name: "list",
        description: "List loaded canonical agents from the state file.",
        action() {
          if (!existsSync(DEFAULT_STATE_PATH)) {
            console.log("No state file found. Run `sync` first.");
            return;
          }
          const state = JSON.parse(
            readFileSync(DEFAULT_STATE_PATH, "utf-8"),
          ) as Record<string, string>;
          const files = Object.keys(state);
          if (files.length === 0) {
            console.log("No canonical agents loaded.");
          } else {
            console.log("Loaded canonical agents:");
            for (const f of files) {
              console.log(`  ${f}`);
            }
          }
        },
      },
      {
        name: "sync",
        description:
          "Force sync all agents from watched directories (bypasses hash check).",
        async action() {
          const configPath = api.getConfigPath();
          const files = await discoverFiles(watchDirs, filePattern);
          const result = reconcile(
            files,
            configPath,
            DEFAULT_STATE_PATH,
            pluginConfig,
            true,
          );
          console.log(
            `Sync complete. Upserted: ${result.upserted.length}, Removed: ${result.removed.length}, Skipped: ${result.skipped.length}`,
          );
        },
      },
      {
        name: "validate",
        description: "Parse agent files and report validation errors.",
        args: [{ name: "path", required: false }],
        async action(targetPath?: unknown) {
          const files =
            typeof targetPath === "string"
              ? [targetPath]
              : await discoverFiles(watchDirs, filePattern);
          let hasErrors = false;
          for (const f of files) {
            try {
              parseAgentFile(f);
              console.log(`✓ ${f}`);
            } catch (err) {
              console.error(`✗ ${f}: ${String(err)}`);
              hasErrors = true;
            }
          }
          if (!hasErrors) {
            console.log("All agent files are valid.");
          }
        },
      },
      {
        name: "preview",
        description:
          "Parse one agent file and print the resulting OpenClaw JSON.",
        args: [{ name: "path", required: true }],
        action(targetPath?: unknown) {
          if (typeof targetPath !== "string") {
            console.error("Usage: openclaw-canonical-agents preview <path>");
            return;
          }
          try {
            const parsed = parseAgentFile(targetPath);
            const entry = toOpenClawAgent(parsed, pluginConfig);
            console.log(JSON.stringify(entry, null, 2));
          } catch (err) {
            console.error(`Error: ${String(err)}`);
          }
        },
      },
      {
        name: "purge",
        description:
          "Remove all agents managed by this plugin from openclaw.json.",
        async action() {
          const configPath = api.getConfigPath();
          const readline = await import("node:readline");
          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
          });
          rl.question(
            "This will remove all cn_* agents from openclaw.json. Proceed? [y/N] ",
            (answer) => {
              rl.close();
              if (answer.toLowerCase() === "y") {
                purge(configPath, DEFAULT_STATE_PATH);
                console.log("Purge complete.");
              } else {
                console.log("Aborted.");
              }
            },
          );
        },
      },
    ],
  });
}
