# OpenClaw Canonical Agents Plugin

**Specification v1.0** | March 2026

---

## 1. Overview

A plugin for OpenClaw that watches a canonical agents repository for `.agent.md` files (markdown with YAML frontmatter) and dynamically provisions them as OpenClaw agents via configuration reconciliation.

**Core value**: Define agents in human-readable markdown files, version them in git, and have OpenClaw pick them up automatically — without editing `openclaw.json` by hand.

---

## 2. Background

### 2.1 The Problem

OpenClaw agents are configured in `openclaw.json` under `agents.list[]`. This works, but:

- Hard to version control individual agents
- No way to share agent definitions across projects

### 2.2 Existing Patterns in the Ecosystem

Other AI coding tools use markdown with frontmatter for agent definitions:

| Tool | Location | Format |
|------|----------|--------|
| Claude Code | `.claude/agents/*.md` | YAML frontmatter + markdown body |
| GitHub Copilot | `.github/agents/*.agent.md` | YAML frontmatter + markdown body |
| OpenAI Codex | `.codex/config.toml` | TOML sections |

The frontmatter pattern is popular because it is readable, versionable, and separates config from content.

### 2.3 Why OpenClaw as Target

OpenClaw is **model-agnostic**. When you define `tools.allow: ["read", "exec"]`, it works regardless of which provider is active (Claude, GPT, Gemini, Ollama). The plugin translates once to OpenClaw's format, and OpenClaw handles provider abstraction.

Example (from [docs.openclaw.ai/tools](https://docs.openclaw.ai/tools)):
```json
{
  "tools": {
    "allow": ["group:fs", "group:runtime"],
    "byProvider": {
      "openai/gpt-5.2": { "allow": ["group:fs"] }
    }
  }
}
```

### 2.4 Use Cases

1. **Canonical agents repository**: Keep all agent definitions in a single git repo (`~/agents-repo/`). Each agent lives in its own directory with an `AGENTS.md` file. The plugin watches the repo and syncs definitions to OpenClaw.

2. **Rapid prototyping**: Edit a markdown file, save, agent updates automatically via hot reload.

3. **Personal agents directory**: Alternatively, keep agents in `~/.agents/` for personal use outside a shared repo.

### 2.5 References

- **AGENTS.md Specification**: https://agents.md/
- **OpenClaw Configuration**: https://docs.openclaw.ai/gateway/configuration
- **OpenClaw Tools**: https://docs.openclaw.ai/tools
- **OpenClaw Multi-Agent**: https://docs.openclaw.ai/tools/multi-agent-sandbox-tools
- **OpenClaw Plugins**: https://docs.openclaw.ai/tools/plugin
- **Claude Code Subagents**: https://code.claude.com/docs/en/sub-agents
- **GitHub Copilot Agents**: https://docs.github.com/en/copilot/reference/custom-agents-configuration
- **OpenAI Codex Multi-Agent**: https://developers.openai.com/codex/multi-agent

---

## 3. Design

### 3.1 Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                 CANONICAL AGENTS PLUGIN                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐   │
│  │ File Watcher │───▶│   Parser     │───▶│   Reconciler     │   │
│  │ (chokidar)   │    │ (gray-matter)│    │ (hash-based)     │   │
│  └──────────────┘    └──────────────┘    └──────────────────┘   │
│                                                │                 │
│                                                ▼                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              OpenClaw Config Writer                       │   │
│  │  - Merges agents into openclaw.json                      │   │
│  │  - Triggers hot reload automatically                      │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Reconciliation Flow

```
1. FILE CHANGE DETECTED
   └─▶ coder/AGENTS.md modified (or reviewer.agent.md)

2. PARSE
   └─▶ Extract YAML frontmatter + markdown body

3. HASH CHECK
   ├─▶ Unchanged? → Skip
   └─▶ Changed?   → Continue

4. TRANSLATE
   └─▶ Frontmatter → OpenClaw agent config

5. MERGE
   └─▶ Upsert into agents.list[]

6. WRITE
   └─▶ Update openclaw.json (hot reload triggers automatically)
```

### 3.3 Idempotency and Ownership Convention

The plugin tracks state via content hashes (stored in its own state file, not in `openclaw.json`). Running it multiple times with unchanged files produces no writes.

Since OpenClaw uses strict schema validation (`additionalProperties: false` via Zod `.strict()`), custom metadata fields like `_managedBy` cannot be added to agent entries — the gateway would reject them at startup. Instead, **agent ownership is encoded in the `id` prefix**:

| Prefix | Owner | Example |
|--------|-------|---------|
| `cn_` | Canonical Agents Plugin | `cn_coder`, `cn_reviewer` |
| (none or other) | Manual or other plugins | `coder-project-a`, `my-agent` |

The plugin only manages agents whose `id` starts with `cn_`. All other agents are left untouched. The `purge` command removes only `cn_*` entries.

The prefix is applied automatically: in the `.agent.md` file, the user writes `id: coder`; the plugin writes `"id": "cn_coder"` to `openclaw.json`. Hash state is stored in a separate file (`~/.openclaw/canonical-agents-state.json`), not in the config.

### 3.4 Hot Reload

OpenClaw watches `openclaw.json` and applies changes without restart for most fields, including `agents.list[]`. The plugin simply writes to the config file; no restart management needed.

### 3.5 Interaction with Manually Defined Agents

The plugin only touches agents whose `id` starts with `cn_`. Any agent with a different prefix or no prefix is ignored during reconciliation — whether manually defined or managed by other plugins. This allows users to have a mix of canonical agents (managed by this plugin) and custom agents (defined manually or by other plugins) in the same `openclaw.json` without conflicts.

---

## 4. Agent File Format

### 4.1 Repository Structure

Following the vision document, canonical agents live in a dedicated git repository:

```
~/agents-repo/
├── coder/
│   └── AGENTS.md
├── reviewer/
│   └── AGENTS.md
└── tester/
    └── AGENTS.md
```

Alternatively, flat `.agent.md` files are also supported for simpler setups:

```
~/.agents/
├── coder.agent.md
├── reviewer.agent.md
└── tester.agent.md
```

The plugin detects both patterns based on its `filePattern` configuration.

### 4.2 File Structure

```markdown
---
# YAML frontmatter (configuration)
id: coder
description: Implements features and fixes bugs
tools:
  allow: [exec, read, write, apply_patch]
---

# Markdown body (system prompt / instructions)

You are a senior developer...
```

### 4.3 Frontmatter Fields

#### Identity (required)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | **Yes** | Unique identifier. Lowercase, alphanumeric, hyphens. |
| `name` | string | No | Display name. Defaults to `id`. |
| `description` | string | **Yes** | Purpose description. Used for agent selection. |

If `id` is omitted, it is derived from the directory name (for `coder/AGENTS.md` → `coder`) or from the filename (for `coder.agent.md` → `coder`).

#### Model (optional)

| Field | Type | Description |
|-------|------|-------------|
| `model.primary` | string | Primary model in `provider/model` format. |
| `model.fallbacks` | string[] | Fallback chain if primary fails. |

```yaml
model:
  primary: anthropic/claude-sonnet-4-5
  fallbacks:
    - openai/gpt-5.2
    - ollama/llama-4
```

When omitted, inherits from `agents.defaults` in `openclaw.json`.

#### Tools (optional)

| Field | Type | Description |
|-------|------|-------------|
| `tools.allow` | string[] | Allowlist. Inherits from `agents.defaults` if omitted. |
| `tools.deny` | string[] | Denylist. Takes precedence over allow. |
| `tools.byProvider` | object | Per-provider restrictions. |

```yaml
tools:
  allow:
    - read
    - write
    - exec
    - group:fs
  deny:
    - apply_patch
  byProvider:
    openai/gpt-5.2:
      allow: [read, write]
```

**Available tools**: `read`, `write`, `edit`, `apply_patch`, `exec`, `process`, `browser`, `web_search`, `web_fetch`, `sessions_list`, `sessions_spawn`, `sessions_send`, `nodes`, `canvas`, `cron`, `gateway`, `image`, `tts`

**Tool groups**: `group:fs`, `group:runtime`, `group:openclaw`

#### Workspace (optional)

| Field | Type | Description |
|-------|------|-------------|
| `workspace` | string | Agent workspace path. Supports `~`. |

When using the repository structure (`coder/AGENTS.md`), the workspace defaults to the parent directory of the agent file (i.e., `~/agents-repo/coder`). This is also where the system prompt is read from (OpenClaw injects `{workspace}/AGENTS.md` into the agent's context).

#### Sandbox (optional)

| Field | Type | Values | Description |
|-------|------|--------|-------------|
| `sandbox.mode` | string | `off`, `non-main`, `all` | When to sandbox |
| `sandbox.scope` | string | `session`, `agent`, `shared` | Sandbox isolation level |
| `sandbox.workspaceAccess` | string | `none`, `ro`, `rw` | Host workspace mount |

```yaml
sandbox:
  mode: all
  scope: session
  workspaceAccess: none
```

#### Routing (optional)

| Field | Type | Description |
|-------|------|-------------|
| `bindings` | array | Route specific channels/peers to this agent |
| `default` | boolean | Set as default agent (only one allowed) |

```yaml
bindings:
  - match:
      provider: whatsapp
      peer:
        kind: group
        id: "120363424282127706@g.us"

default: false
```

#### Control (optional)

| Field | Type | Description |
|-------|------|-------------|
| `disabled` | boolean | Skip this agent during reconciliation |

### 4.4 Markdown Body

The markdown body becomes the agent's system prompt. It is written to `{workspace}/AGENTS.md` so OpenClaw injects it on first turn.

```markdown
# Coder Agent

You are a senior developer specialized in full-stack development.

## Responsibilities

- Implement features following the specifications
- Write clean, testable code
- Follow project conventions and patterns

## Constraints

- Always run tests before marking work as done
- Never modify files outside the task worktree
```

---

## 5. Translation

### 5.1 Mapping to OpenClaw

| Frontmatter | OpenClaw Config |
|-------------|-----------------|
| `id` | `agents.list[].id` (prefixed as `cn_{id}`) |
| `name` | `agents.list[].name` |
| `description` | (used for routing, not stored in config) |
| `model.primary` | `agents.list[].model.primary` |
| `model.fallbacks` | `agents.list[].model.fallbacks` |
| `tools.allow` | `agents.list[].tools.allow` |
| `tools.deny` | `agents.list[].tools.deny` |
| `tools.byProvider` | `agents.list[].tools.byProvider` |
| `workspace` | `agents.list[].workspace` |
| `sandbox.*` | `agents.list[].sandbox.*` |
| `bindings` | Top-level `bindings[]` with `agentId` |
| `default` | `agents.list[].default` |
| (markdown body) | Written to `{workspace}/AGENTS.md` |

### 5.2 System Prompt Handling

The markdown body is written to `{workspace}/AGENTS.md` so OpenClaw injects it into the agent's context on first turn. If the file already exists and has not changed (by hash), it is not rewritten.

### 5.3 Example Translation

Given this agent file:

```markdown
---
id: reviewer
name: Code Reviewer
description: Reviews code for quality and security
model:
  primary: anthropic/claude-sonnet-4-5
tools:
  allow: [read, exec]
  deny: [write, apply_patch]
sandbox:
  mode: all
  scope: session
  workspaceAccess: ro
---

You are a senior code reviewer...
```

The plugin produces this entry in `openclaw.json`:

```json
{
  "id": "cn_reviewer",
  "name": "Code Reviewer",
  "workspace": "~/agents-repo/reviewer",
  "model": {
    "primary": "anthropic/claude-sonnet-4-5"
  },
  "tools": {
    "allow": ["read", "exec"],
    "deny": ["write", "apply_patch"]
  },
  "sandbox": {
    "mode": "all",
    "scope": "session",
    "workspaceAccess": "ro"
  }
}
```

And writes the markdown body to `~/agents-repo/reviewer/AGENTS.md`.

---

## 6. Plugin Configuration

```json
{
  "plugins": {
    "canonical-agents": {
      "enabled": true,
      "watchDirs": ["~/agents-repo", "~/.agents"],
      "filePattern": ["**/AGENTS.md", "**/*.agent.md"],
      "debounceMs": 500,
      "defaultWorkspaceBase": "~/.openclaw/workspaces"
    }
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable/disable the plugin |
| `watchDirs` | string[] | `["~/agents-repo"]` | Directories to watch for agent files |
| `filePattern` | string[] | `["**/AGENTS.md", "**/*.agent.md"]` | Glob patterns to match agent files |
| `debounceMs` | number | `500` | Debounce interval for file change events |
| `defaultWorkspaceBase` | string | `~/.openclaw/workspaces` | Base path for auto-generated workspaces (when not using repo structure) |

---

## 7. CLI

```bash
# List loaded canonical agents
openclaw canonical-agents list

# Force sync all agents from watched directories
openclaw canonical-agents sync

# Validate agent files without applying changes
openclaw canonical-agents validate [path]

# Preview the OpenClaw config that would be generated
openclaw canonical-agents preview ./coder/AGENTS.md

# Remove all agents managed by this plugin
openclaw canonical-agents purge
```

---

## 8. Examples

### 8.1 Minimal Agent

```markdown
---
id: helper
description: General-purpose assistant
---

You are a helpful assistant.
```

### 8.2 Coder Agent (from Vision)

```markdown
---
id: coder
name: Coder
description: Implements features and fixes following specifications

model:
  primary: anthropic/claude-sonnet-4-5

tools:
  allow: [exec, read, write, apply_patch]
  deny: [browser]

sandbox:
  mode: all
  scope: session
  workspaceAccess: none
---

# Coder Agent

You are a senior developer specialized in full-stack development.

## Responsibilities

- Implement features following the specifications
- Write clean, testable code
- Follow project conventions and patterns

## Constraints

- Always run tests before marking work as done
- Never modify files outside the task worktree
- Commit with clear, descriptive messages
```

### 8.3 Reviewer Agent (from Vision)

```markdown
---
id: reviewer
name: Code Reviewer
description: Reviews code for quality, security, and best practices

model:
  primary: anthropic/claude-sonnet-4-5

tools:
  allow: [read]
  deny: [exec, write, apply_patch]

sandbox:
  mode: all
  scope: session
  workspaceAccess: ro
---

# Code Reviewer

You are a senior code reviewer focused on quality and security.

## Responsibilities

- Review code changes for bugs and vulnerabilities
- Verify test coverage
- Provide actionable feedback with examples

## Output Format

Organize findings by priority:
- Critical: Must fix before merge
- Warning: Should fix
- Suggestion: Nice to have

Never modify code directly. Only review and suggest.
```

### 8.4 Multi-Channel Agent

```markdown
---
id: family-bot
name: Family Assistant
description: Shared assistant for family group chat

model:
  primary: openai/gpt-5.2

tools:
  allow: [read, web_search]
  deny: [exec, write]

workspace: ~/.openclaw/workspaces/family

bindings:
  - match:
      provider: whatsapp
      peer:
        kind: group
        id: "120363424282127706@g.us"

sandbox:
  mode: all
  scope: agent
---

You are a family assistant. Be helpful, friendly, and appropriate for all ages.
```

---

## 9. Limitations

1. **No runtime plugin API**: OpenClaw does not support registering agents programmatically. This plugin works by modifying `openclaw.json` and relying on hot reload.

2. **Provider behavior varies**: Tool abstraction works at the API level, but different models interpret the same prompts differently. May need per-provider prompt tuning.

---

## 10. Future Work

- `$include` support for composing agent prompts from fragments
- MCP server references in frontmatter
- Skills auto-loading from agent definitions
- Hooks for agent lifecycle events (on-load, on-change, on-remove)
- Watch mode for remote directories (S3, git repos)
