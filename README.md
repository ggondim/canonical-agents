# canonical-agents

An [OpenClaw](https://docs.openclaw.ai) plugin that watches directories for `.agent.md` and `AGENTS.md` files — markdown with YAML frontmatter — and dynamically provisions them as OpenClaw agents via configuration reconciliation.

Define agents in human-readable markdown files, version them in git, and have OpenClaw pick them up automatically — without editing `openclaw.json` by hand.

## Intended Use

This plugin is designed for teams and individuals who want to:

- **Version control agent definitions** — each agent lives in its own markdown file, trackable with git.
- **Share agents across projects** — keep a canonical agents repository (`~/agents-repo/`) and point multiple OpenClaw instances at it.
- **Rapidly prototype agents** — edit a markdown file, save, and the agent updates automatically via hot reload. No restart needed.
- **Separate agent configuration from prompts** — YAML frontmatter holds config (model, tools, sandbox), while the markdown body holds the system prompt.

The plugin watches your agent files with [chokidar](https://github.com/paulmillr/chokidar), parses them with [gray-matter](https://github.com/jonschlinkert/gray-matter), and reconciles them into `openclaw.json` using SHA-256 hash-based change detection. Unchanged files are skipped; removed files cause their agents to be cleaned up.

## Getting Started

### Installation

Install the plugin with your preferred package manager:

```bash
npm install openclaw-canonical-agents
# or
pnpm add openclaw-canonical-agents
```

### Basic Configuration

Register the plugin in your `openclaw.json`:

```json
{
  "plugins": {
    "canonical-agents": {
      "enabled": true,
      "watchDirs": ["~/agents-repo"]
    }
  }
}
```

### Creating Your First Agent

Create a directory for your agents and add a markdown file:

```bash
mkdir -p ~/agents-repo/helper
```

Create `~/agents-repo/helper/AGENTS.md`:

```markdown
---
id: helper
description: General-purpose assistant
---

You are a helpful assistant. Answer questions clearly and concisely.
```

Once the plugin detects the file, it provisions the agent as `cn_helper` in `openclaw.json`. The `cn_` prefix is added automatically to distinguish plugin-managed agents from manually defined ones.

### Agent File Patterns

The plugin supports two file organization patterns:

**Directory structure** (recommended for repos):

```
~/agents-repo/
├── coder/
│   └── AGENTS.md
├── reviewer/
│   └── AGENTS.md
└── tester/
    └── AGENTS.md
```

**Flat files** (simpler for personal use):

```
~/.agents/
├── coder.agent.md
├── reviewer.agent.md
└── tester.agent.md
```

## Reference

### Plugin Configuration

All options are set under `plugins.canonical-agents` in `openclaw.json`:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable or disable the plugin. |
| `watchDirs` | string[] | `["~/agents-repo"]` | Directories to watch for agent files. |
| `filePattern` | string[] | `["**/AGENTS.md", "**/*.agent.md"]` | Glob patterns used to discover agent files inside `watchDirs`. |
| `debounceMs` | number | `500` | Debounce interval (ms) for file-change events. |
| `defaultWorkspaceBase` | string | `"~/.openclaw/workspaces"` | Base path for auto-generated workspaces when the agent file doesn't specify one. |

Full example:

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

### Frontmatter Fields

#### Identity

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | No | Unique identifier. Lowercase alphanumeric with hyphens. If omitted, derived from the directory or file name. |
| `name` | string | No | Display name. Defaults to `id`. |
| `description` | string | **Yes** | Purpose description. Used for agent selection. |

#### Model

| Field | Type | Description |
|-------|------|-------------|
| `model.primary` | string | Primary model in `provider/model` format. |
| `model.fallbacks` | string[] | Fallback chain if the primary model is unavailable. |

When omitted, inherits from `agents.defaults` in `openclaw.json`.

#### Tools

| Field | Type | Description |
|-------|------|-------------|
| `tools.allow` | string[] | Tool allowlist. Inherits from `agents.defaults` if omitted. |
| `tools.deny` | string[] | Tool denylist. Takes precedence over allow. |
| `tools.byProvider` | object | Per-provider tool restrictions. |

Available tools: `read`, `write`, `edit`, `apply_patch`, `exec`, `process`, `browser`, `web_search`, `web_fetch`, `sessions_list`, `sessions_spawn`, `sessions_send`, `nodes`, `canvas`, `cron`, `gateway`, `image`, `tts`

Tool groups: `group:fs`, `group:runtime`, `group:openclaw`

#### Workspace

| Field | Type | Description |
|-------|------|-------------|
| `workspace` | string | Agent workspace path. Supports `~` expansion. |

For the directory structure (`coder/AGENTS.md`), the workspace defaults to the parent directory of the agent file. For flat files (`coder.agent.md`), it defaults to `{defaultWorkspaceBase}/{id}`.

#### Sandbox

| Field | Type | Values | Description |
|-------|------|--------|-------------|
| `sandbox.mode` | string | `off`, `non-main`, `all` | When to sandbox. |
| `sandbox.scope` | string | `session`, `agent`, `shared` | Sandbox isolation level. |
| `sandbox.workspaceAccess` | string | `none`, `ro`, `rw` | Host workspace mount mode. |

#### Routing

| Field | Type | Description |
|-------|------|-------------|
| `bindings` | array | Route specific channels/peers to this agent. |
| `default` | boolean | Set as the default agent (only one allowed). |

#### Control

| Field | Type | Description |
|-------|------|-------------|
| `disabled` | boolean | Skip this agent during reconciliation. |

### CLI Commands

All commands are available under the `canonical-agents` namespace:

```bash
# List agents currently tracked in the state file
openclaw canonical-agents list

# Force sync all agents from watched directories (bypasses hash check)
openclaw canonical-agents sync

# Validate agent files and report errors without applying changes
openclaw canonical-agents validate [path]

# Preview the OpenClaw JSON that would be generated for a single agent
openclaw canonical-agents preview <path>

# Remove all cn_* agents from openclaw.json (prompts for confirmation)
openclaw canonical-agents purge
```

## Advanced Usage

### Coder Agent with Sandboxing

A full-featured coder agent with model selection, tool restrictions, and sandboxing:

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

### Read-Only Reviewer

A reviewer agent that can read code and run tests but cannot modify files:

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

## Output Format

Organize findings by priority:
- Critical: Must fix before merge
- Warning: Should fix
- Suggestion: Nice to have

Never modify code directly. Only review and suggest.
```

### Per-Provider Tool Restrictions

Restrict certain tools based on the active model provider:

```markdown
---
id: writer
description: Technical writer with web access
model:
  primary: anthropic/claude-sonnet-4-5
  fallbacks:
    - openai/gpt-5.2
    - ollama/llama-4
tools:
  allow: [read, write, web_search, web_fetch]
  byProvider:
    openai/gpt-5.2:
      allow: [read, write]
    ollama/llama-4:
      allow: [read]
---

You are a technical writer. Research topics using web search and produce clear documentation.
```

### Multi-Channel Agent with Bindings

An agent bound to a specific WhatsApp group chat:

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

### Watching Multiple Directories

Point the plugin at both a shared team repo and a personal agents directory:

```json
{
  "plugins": {
    "canonical-agents": {
      "watchDirs": ["~/team-agents", "~/.my-agents"],
      "filePattern": ["**/AGENTS.md", "**/*.agent.md"]
    }
  }
}
```

### Disabling an Agent Without Deleting It

Set `disabled: true` in the frontmatter to skip the agent during reconciliation:

```markdown
---
id: experimental
description: Work-in-progress agent
disabled: true
---

This agent will not be provisioned until disabled is removed or set to false.
```

## Background

OpenClaw agents are configured in `openclaw.json` under `agents.list[]`. While functional, this approach makes it difficult to version control individual agents or share definitions across projects.

Several AI coding tools have adopted a pattern of defining agents in markdown files with YAML frontmatter:

| Tool | Location | Format |
|------|----------|--------|
| Claude Code | `.claude/agents/*.md` | YAML frontmatter + markdown body |
| GitHub Copilot | `.github/agents/*.agent.md` | YAML frontmatter + markdown body |
| OpenAI Codex | `.codex/config.toml` | TOML sections |

This plugin brings that same pattern to OpenClaw. Since OpenClaw is model-agnostic, an agent definition written once works across all providers (Claude, GPT, Gemini, Ollama) — the plugin translates to OpenClaw's format, and OpenClaw handles provider abstraction.

For the complete technical specification including architecture, reconciliation flow, translation mapping, and design decisions, see [SPEC.md](SPEC.md).
