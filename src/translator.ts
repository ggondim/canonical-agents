import { basename, dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { CN_PREFIX } from "./constants.js";
import type { ParsedAgent } from "./schema.js";

export interface PluginConfig {
  enabled?: boolean;
  watchDirs?: string[];
  filePattern?: string[];
  debounceMs?: number;
  defaultWorkspaceBase?: string;
}

export interface OpenClawToolsEntry {
  allow?: string[];
  deny?: string[];
  byProvider?: Record<string, { allow?: string[]; deny?: string[] }>;
}

export interface OpenClawSandboxEntry {
  mode?: "off" | "non-main" | "all";
  scope?: "session" | "agent" | "shared";
  workspaceAccess?: "none" | "ro" | "rw";
}

export interface OpenClawModelEntry {
  primary?: string;
  fallbacks?: string[];
}

export interface OpenClawAgentEntry {
  id: string;
  name?: string;
  workspace?: string;
  model?: OpenClawModelEntry;
  tools?: OpenClawToolsEntry;
  sandbox?: OpenClawSandboxEntry;
  default?: boolean;
}

export interface Binding {
  agentId: string;
  match?: {
    provider?: string;
    peer?: { kind?: string; id?: string };
  };
}

function expandHome(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    return p.replace("~", homedir());
  }
  return p;
}

function resolveWorkspace(parsed: ParsedAgent, defaults: PluginConfig): string {
  if (parsed.workspace) {
    return expandHome(parsed.workspace);
  }
  const agentFile = basename(parsed.filePath);
  if (agentFile.toLowerCase() === "agents.md") {
    return resolve(dirname(parsed.filePath));
  }
  const base = defaults.defaultWorkspaceBase ?? "~/.openclaw/workspaces";
  return resolve(expandHome(base), parsed.id);
}

export function toOpenClawAgent(
  parsed: ParsedAgent,
  defaults: PluginConfig,
): OpenClawAgentEntry {
  const entry: OpenClawAgentEntry = {
    id: `${CN_PREFIX}${parsed.id}`,
    workspace: resolveWorkspace(parsed, defaults),
  };

  if (parsed.name !== undefined) entry.name = parsed.name;
  if (parsed.model !== undefined) entry.model = parsed.model;
  if (parsed.tools !== undefined) entry.tools = parsed.tools;
  if (parsed.sandbox !== undefined) entry.sandbox = parsed.sandbox;
  if (parsed.default !== undefined) entry.default = parsed.default;

  return entry;
}

export function toBindings(parsed: ParsedAgent): Binding[] {
  if (!parsed.bindings || parsed.bindings.length === 0) return [];
  const agentId = `${CN_PREFIX}${parsed.id}`;
  return parsed.bindings.map((b) => ({
    agentId,
    match: b.match,
  }));
}
