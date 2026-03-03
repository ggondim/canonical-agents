import { z } from "zod/v4";

const ModelSchema = z.object({
  primary: z.string().optional(),
  fallbacks: z.array(z.string()).optional(),
});

const ToolsSchema = z.object({
  allow: z.array(z.string()).optional(),
  deny: z.array(z.string()).optional(),
  byProvider: z.record(z.string(), z.object({ allow: z.array(z.string()).optional(), deny: z.array(z.string()).optional() })).optional(),
});

const SandboxSchema = z.object({
  mode: z.enum(["off", "non-main", "all"]).optional(),
  scope: z.enum(["session", "agent", "shared"]).optional(),
  workspaceAccess: z.enum(["none", "ro", "rw"]).optional(),
});

const BindingMatchSchema = z.object({
  provider: z.string().optional(),
  peer: z
    .object({
      kind: z.string().optional(),
      id: z.string().optional(),
    })
    .optional(),
});

const BindingSchema = z.object({
  match: BindingMatchSchema.optional(),
});

export const AgentFrontmatterSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9-]+$/, "id must be lowercase alphanumeric with hyphens")
    .optional(),
  name: z.string().optional(),
  description: z.string(),
  model: ModelSchema.optional(),
  tools: ToolsSchema.optional(),
  workspace: z.string().optional(),
  sandbox: SandboxSchema.optional(),
  bindings: z.array(BindingSchema).optional(),
  default: z.boolean().optional(),
  disabled: z.boolean().optional(),
});

export type AgentFrontmatter = z.infer<typeof AgentFrontmatterSchema>;

export const ParsedAgentSchema = AgentFrontmatterSchema.extend({
  id: z.string(),
  filePath: z.string(),
  body: z.string(),
});

export type ParsedAgent = z.infer<typeof ParsedAgentSchema>;
