/**
 * The facts of every harness an Agent node can run on, keyed by name, in the
 * order the pickers show them. Each harness gives its own facts in a file of
 * this folder (`claude-code.ts`, `acp.ts`). This table only collects them.
 * Like `facts.ts`, it imports no adapter code and no `node:` module.
 */
import type { HarnessName } from "../../port";
import type { HarnessFacts } from "../harness-record";
import { ACP_FACTS } from "./acp";
import { CLAUDE_CODE_FACTS } from "./claude-code";
import { CODEX_FACTS } from "./codex";
import { GROK_BUILD_FACTS } from "./grok-build";
import { OPENCODE_FACTS } from "./opencode";

export const HARNESS_FACTS: Record<HarnessName, HarnessFacts> = {
	"claude-code": CLAUDE_CODE_FACTS,
	opencode: OPENCODE_FACTS,
	codex: CODEX_FACTS,
	"grok-build": GROK_BUILD_FACTS,
	...ACP_FACTS,
};
