import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_STATE_PATH = join(
  homedir(),
  ".openclaw",
  "openclaw-canonical-agents-state.json",
);

export const CN_PREFIX = "cn_";
