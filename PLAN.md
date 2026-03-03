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

All tasks have been completed.

