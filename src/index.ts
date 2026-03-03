import { glob } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { watch, type FSWatcher } from "chokidar";
import { DEFAULT_STATE_PATH } from "./constants.js";
import { reconcile } from "./reconciler.js";
import { registerCli } from "./cli.js";

export interface OpenClawPluginApi {
  registerService(service: {
    start: () => void | Promise<void>;
    stop: () => void | Promise<void>;
  }): void;
  on(event: string, handler: (...args: unknown[]) => void): void;
  registerCli(definition: CliDefinition): void;
  getPluginConfig<T>(pluginId: string): T;
  getConfigPath(): string;
}

export interface CliDefinition {
  name: string;
  commands: CliCommand[];
}

export interface CliCommand {
  name: string;
  description: string;
  args?: CliArg[];
  action: (...args: unknown[]) => void | Promise<void>;
}

export interface CliArg {
  name: string;
  required: boolean;
}

export interface PluginConfig {
  enabled?: boolean;
  watchDirs?: string[];
  filePattern?: string[];
  debounceMs?: number;
  defaultWorkspaceBase?: string;
}

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

export default function register(api: OpenClawPluginApi): void {
  let watcher: FSWatcher | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function getConfig(): PluginConfig {
    try {
      return api.getPluginConfig<PluginConfig>("canonical-agents");
    } catch {
      return {};
    }
  }

  async function runSync(forceAll = false): Promise<void> {
    const config = getConfig();
    if (config.enabled === false) return;

    const watchDirs = config.watchDirs ?? ["~/agents-repo"];
    const filePattern = config.filePattern ?? [
      "**/AGENTS.md",
      "**/*.agent.md",
    ];
    const configPath = api.getConfigPath();

    const files = await discoverFiles(watchDirs, filePattern);
    reconcile(files, configPath, DEFAULT_STATE_PATH, config, forceAll);
  }

  function scheduleSync(debounceMs: number): void {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      void runSync();
    }, debounceMs);
  }

  api.registerService({
    async start() {
      const config = getConfig();
      if (config.enabled === false) return;

      await runSync();

      const watchDirs = (config.watchDirs ?? ["~/agents-repo"]).map(
        expandHome,
      );
      const filePattern = config.filePattern ?? [
        "**/AGENTS.md",
        "**/*.agent.md",
      ];
      const debounceMs = config.debounceMs ?? 500;

      watcher = watch(
        watchDirs.flatMap((d) => filePattern.map((p) => join(d, p))),
        { ignoreInitial: true },
      );

      watcher.on("add", () => scheduleSync(debounceMs));
      watcher.on("change", () => scheduleSync(debounceMs));
      watcher.on("unlink", () => scheduleSync(debounceMs));
    },

    async stop() {
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      if (watcher !== null) {
        await watcher.close();
        watcher = null;
      }
    },
  });

  api.on("config:updated", () => {
    void runSync();
  });

  registerCli(api);
}

