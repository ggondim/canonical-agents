import { readFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import matter from "gray-matter";
import { AgentFrontmatterSchema, ParsedAgent } from "./schema.js";

function deriveId(filePath: string): string {
  const base = basename(filePath);
  if (base.toLowerCase() === "agents.md") {
    return basename(dirname(filePath));
  }
  const match = base.match(/^(.+)\.agent\.md$/i);
  if (match) {
    return match[1];
  }
  return basename(base, ".md");
}

export function parseAgentFile(filePath: string): ParsedAgent {
  const raw = readFileSync(filePath, "utf-8");
  const { data, content } = matter(raw);

  const frontmatter = AgentFrontmatterSchema.parse(data);

  const id = frontmatter.id ?? deriveId(filePath);

  return {
    ...frontmatter,
    id,
    filePath,
    body: content.trim(),
  };
}
