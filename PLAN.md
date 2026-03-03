# Implementation Plan

**Canonical Agents — OpenClaw Plugin**

---

## Stack

| Concern | Choice | Rationale |
|---------|--------|-----------|
| Language | TypeScript (strict) | OpenClaw plugins are TypeScript modules loaded at runtime via jiti |
| ES target | `es2023` | Matches the OpenClaw tsconfig (`"target": "es2023"`) |
| Module system | `NodeNext` (ESM, `"type": "module"`) | Matches the OpenClaw tsconfig and package.json |
| Package manager | pnpm | Matches the OpenClaw monorepo |
| Lint | oxlint | Matches the OpenClaw repo tooling (`oxlint --type-aware`) |
| Format | oxfmt | Matches the OpenClaw repo tooling |
| Build | tsc (type-check only) | Plugins are loaded from source by jiti — no bundle step needed. `tsc --noEmit` validates types. |
| Frontmatter parsing | gray-matter | Standard YAML frontmatter parser for markdown |
| Schema validation | zod | Already used by OpenClaw core for config validation |
| File watching | chokidar | Already a dependency of OpenClaw core |
| Config read/write | Node `fs` + `json5` | OpenClaw configs use JSON5; `json5` is already in the OpenClaw dep tree |
| Plugin manifest | `openclaw.plugin.json` | Required by all OpenClaw plugins for discovery + config validation |

---

## Tasks

### Task 1 — Project scaffolding and tooling

Set up the project skeleton so every subsequent task can lint and type-check.

Files to create:

- `package.json` — `"name": "@canonical-agents/openclaw-plugin"`, `"type": "module"`, dependencies (`gray-matter`, `zod`, `chokidar`, `json5`), devDependencies (`typescript`, `oxlint`, `oxfmt`, `@types/node`), scripts (`lint`, `format`, `typecheck`, `check`)
- `tsconfig.json` — Extend from scratch targeting `es2023` / `NodeNext`, strict mode, `noEmit: true`, `skipLibCheck: true`
- `openclaw.plugin.json` — Manifest with `id: "canonical-agents"` and a `configSchema` covering the plugin config options from SPEC §6 (`enabled`, `watchDirs`, `filePattern`, `debounceMs`, `defaultWorkspaceBase`)
- `src/index.ts` — Plugin entry point stub: `export default function register(api: OpenClawPluginApi) {}`
- `.oxlintrc.json` — Minimal oxlint config

Acceptance: `pnpm install && pnpm typecheck && pnpm lint` passes.

---

### Task 2 — Agent file parser

Implement the module that reads a `.agent.md` or `AGENTS.md` file and returns a typed, validated structure.

Files to create:

- `src/parser.ts`
  - `parseAgentFile(filePath: string): ParsedAgent` — reads the file, extracts YAML frontmatter via `gray-matter`, validates with a Zod schema, derives `id` from the directory or filename when omitted (SPEC §4.3).
- `src/schema.ts`
  - Zod schema for all frontmatter fields defined in SPEC §4.3 (identity, model, tools, workspace, sandbox, routing, control).
  - Export the `ParsedAgent` type inferred from the schema.

Acceptance: `pnpm typecheck && pnpm lint` passes.

---

### Task 3 — Translator and reconciler

Implement the module that converts parsed agents into OpenClaw config entries and reconciles them with the existing `openclaw.json`.

Files to create:

- `src/translator.ts`
  - `toOpenClawAgent(parsed: ParsedAgent, defaults: PluginConfig): OpenClawAgentEntry` — maps frontmatter fields to the OpenClaw config shape (SPEC §5.1), applies the `cn_` prefix to `id`, resolves workspace paths.
  - `toBindings(parsed: ParsedAgent): Binding[]` — extracts top-level bindings with the prefixed `agentId`.
- `src/reconciler.ts`
  - `reconcile(agents: ParsedAgent[], configPath: string, statePath: string): ReconcileResult` — core reconciliation loop:
    1. Compute content hashes (SHA-256) per agent file.
    2. Load previous hashes from the state file. Default path: `~/.openclaw/canonical-agents-state.json` — define this as a constant in a shared `src/constants.ts` file so both the reconciler and CLI can reference it.
    3. Skip unchanged agents (SPEC §3.2, §3.3).
    4. For changed/new agents: translate, upsert into `agents.list[]` (only `cn_*` entries).
    5. Remove `cn_*` entries whose source files no longer exist.
    6. Write the updated `openclaw.json` (JSON5 round-trip via `json5`).
    7. Write the markdown body to `{workspace}/AGENTS.md` when changed.
    8. Persist new hashes to the state file.
  - Export `purge(configPath: string, statePath: string)` — removes all `cn_*` agents and clears state.

Acceptance: `pnpm typecheck && pnpm lint` passes.

---

### Task 4 — Plugin entry point (watcher + lifecycle)

Wire everything together via the OpenClaw plugin API.

Files to modify/create:

- `src/index.ts` — Full plugin registration:
  - Read `pluginConfig` (SPEC §6) for `watchDirs`, `filePattern`, `debounceMs`, `defaultWorkspaceBase`.
  - Register a background **service** (`api.registerService`) that:
    - On `start`: runs an initial full sync (`reconcile`), then starts a chokidar watcher on the configured directories/globs with debounced callbacks.
    - On `stop`: closes the watcher.
  - Register a typed hook via `api.on("config:updated", ...)` to re-read plugin config on hot reload (optional, best-effort).

Acceptance: `pnpm typecheck && pnpm lint` passes.

---

### Task 5 — CLI subcommands

Register the CLI commands from SPEC §7 under `openclaw canonical-agents`.

Files to create:

- `src/cli.ts`
  - `registerCli(api: OpenClawPluginApi)` — calls `api.registerCli(...)` to add:
    - `canonical-agents list` — reads state file, prints loaded agents.
    - `canonical-agents sync` — runs `reconcile` once, bypassing the hash-based skip logic so every discovered agent file is re-parsed, re-translated, and re-written to `openclaw.json` regardless of whether its content has changed.
    - `canonical-agents validate [path]` — parses agent files and reports validation errors without writing.
    - `canonical-agents preview <path>` — parses one file, translates, prints the resulting OpenClaw JSON to stdout.
    - `canonical-agents purge` — calls `purge`, confirms before writing.

Files to modify:

- `src/index.ts` — call `registerCli(api)` during plugin registration.

Acceptance: `pnpm typecheck && pnpm lint` passes.
