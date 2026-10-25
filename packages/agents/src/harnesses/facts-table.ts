/**
 * The facts of every harness an Agent node can run on, keyed by name, in the
 * order the pickers show them. Each harness folder gives its own facts
 * (`<harness>/facts.ts`); this table only collects them. Like `facts.ts`, it
 * imports no adapter code and no `node:` module.
 */
import type { HarnessName } from "../port";
import { ACP_FACTS } from "./acp/facts";
import { CLAUDE_CODE_FACTS } from "./claude-code/facts";
import { CODEX_FACTS } from "./codex/facts";
import { GROK_BUILD_FACTS } from "./grok-build/facts";
import type { HarnessFacts } from "./harness-record";
import { OPENCODE_FACTS } from "./opencode/facts";

export const HARNESS_FACTS: Record<HarnessName, HarnessFacts> = {
	"claude-code": CLAUDE_CODE_FACTS,
	opencode: OPENCODE_FACTS,
	codex: CODEX_FACTS,
	"grok-build": GROK_BUILD_FACTS,
	...ACP_FACTS,
};
