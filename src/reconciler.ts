import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import JSON5 from "json5";
import { DEFAULT_STATE_PATH, CN_PREFIX } from "./constants.js";
import { parseAgentFile } from "./parser.js";
import {
  toBindings,
  toOpenClawAgent,
  type Binding,
  type OpenClawAgentEntry,
  type PluginConfig,
} from "./translator.js";
import type { ParsedAgent } from "./schema.js";

type HashState = Record<string, string>;

interface OpenClawConfig {
  agents?: {
    list?: OpenClawAgentEntry[];
    [key: string]: unknown;
  };
  bindings?: Binding[];
  [key: string]: unknown;
}

export interface ReconcileResult {
  upserted: string[];
  removed: string[];
  skipped: string[];
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function loadState(statePath: string): HashState {
  if (!existsSync(statePath)) return {};
  try {
    return JSON.parse(readFileSync(statePath, "utf-8")) as HashState;
  } catch {
    return {};
  }
}

function saveState(statePath: string, state: HashState): void {
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
}

function loadConfig(configPath: string): OpenClawConfig {
  if (!existsSync(configPath)) return {};
  const raw = readFileSync(configPath, "utf-8");
  return JSON5.parse(raw) as OpenClawConfig;
}

function saveConfig(configPath: string, config: OpenClawConfig): void {
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
}

function writeAgentPrompt(agent: OpenClawAgentEntry, body: string): void {
  if (!agent.workspace || !body) return;
  const promptPath = join(agent.workspace, "AGENTS.md");
  const existing = existsSync(promptPath)
    ? readFileSync(promptPath, "utf-8")
    : null;
  if (existing === body) return;
  mkdirSync(agent.workspace, { recursive: true });
  writeFileSync(promptPath, body, "utf-8");
}

export function reconcile(
  agentFiles: string[],
  configPath: string,
  statePath: string = DEFAULT_STATE_PATH,
  pluginConfig: PluginConfig = {},
  forceAll = false,
): ReconcileResult {
  const result: ReconcileResult = { upserted: [], removed: [], skipped: [] };
  const state = loadState(statePath);
  const config = loadConfig(configPath);
  config.agents ??= {};
  config.agents.list ??= [];
  config.bindings ??= [];

  const newState: HashState = {};
  const parsedAgents: ParsedAgent[] = [];

  for (const filePath of agentFiles) {
    let parsed: ParsedAgent;
    try {
      parsed = parseAgentFile(filePath);
    } catch {
      continue;
    }

    if (parsed.disabled) {
      result.skipped.push(parsed.id);
      continue;
    }

    const raw = readFileSync(filePath, "utf-8");
    const hash = sha256(raw);
    newState[filePath] = hash;

    if (!forceAll && state[filePath] === hash) {
      result.skipped.push(parsed.id);
      parsedAgents.push(parsed);
      continue;
    }

    const entry = toOpenClawAgent(parsed, pluginConfig);
    const bindings = toBindings(parsed);

    const list = config.agents.list as OpenClawAgentEntry[];
    const idx = list.findIndex((a) => a.id === entry.id);
    if (idx >= 0) {
      list[idx] = entry;
    } else {
      list.push(entry);
    }

    config.bindings = [
      ...(config.bindings as Binding[]).filter((b) => b.agentId !== entry.id),
      ...bindings,
    ];

    writeAgentPrompt(entry, parsed.body);
    result.upserted.push(parsed.id);
    parsedAgents.push(parsed);
  }

  const activeIds = new Set(
    parsedAgents.map((p) => `${CN_PREFIX}${p.id}`),
  );

  const list = config.agents.list as OpenClawAgentEntry[];
  const toRemove = list.filter(
    (a) => a.id.startsWith(CN_PREFIX) && !activeIds.has(a.id),
  );
  config.agents.list = list.filter(
    (a) => !a.id.startsWith(CN_PREFIX) || activeIds.has(a.id),
  );
  config.bindings = (config.bindings as Binding[]).filter(
    (b) => !b.agentId.startsWith(CN_PREFIX) || activeIds.has(b.agentId),
  );
  for (const a of toRemove) {
    result.removed.push(a.id);
  }

  if (
    result.upserted.length > 0 ||
    result.removed.length > 0 ||
    forceAll
  ) {
    saveConfig(configPath, config);
  }

  saveState(statePath, newState);
  return result;
}

export function purge(
  configPath: string,
  statePath: string = DEFAULT_STATE_PATH,
): void {
  const config = loadConfig(configPath);
  if (config.agents?.list) {
    config.agents.list = (config.agents.list as OpenClawAgentEntry[]).filter(
      (a) => !a.id.startsWith(CN_PREFIX),
    );
  }
  if (config.bindings) {
    config.bindings = (config.bindings as Binding[]).filter(
      (b) => !b.agentId.startsWith(CN_PREFIX),
    );
  }
  saveConfig(configPath, config);
  if (existsSync(statePath)) {
    writeFileSync(statePath, "{}", "utf-8");
  }
}
