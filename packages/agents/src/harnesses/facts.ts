/**
 * The port-side facts about each harness: what `AgentHarness` promises the
 * engine beyond `run`, keyed by name. Every harness adapter and the fake
 * (`testing/fake.ts`) implement `label` and `takeOverCommand` from this
 * table, so a fake and a real harness are interchangeable at the same seam.
 *
 * Each harness folder gives its own facts (`<harness>/facts.ts`). This
 * module only collects them. It is the `./harness-facts` entry: it imports
 * no adapter code and no `node:` module, so it is browser-safe, an adapter
 * may import it without a cycle, and the engine may use `HARNESS_LABELS`
 * for a harness it has no instance of (one that is not added).
 */
import { customAgentSlug, isCustomHarness } from "@nightshift/flows";
import {
	type AgentHarness,
	type AgentHarnessName,
	type HarnessName,
	shellQuote,
} from "../port";
import { ACP_FACTS } from "./acp/facts";
import { CLAUDE_CODE_FACTS } from "./claude-code/facts";
import { CODEX_FACTS } from "./codex/facts";
import { GROK_BUILD_FACTS } from "./grok-build/facts";
import type { HarnessFacts } from "./harness-record";
import { OPENCODE_FACTS } from "./opencode/facts";

export { shellQuote };

/** Every harness an Agent node can run on, in the order the pickers show them. */
export const HARNESS_FACTS: Record<HarnessName, HarnessFacts> = {
	"claude-code": CLAUDE_CODE_FACTS,
	opencode: OPENCODE_FACTS,
	codex: CODEX_FACTS,
	"grok-build": GROK_BUILD_FACTS,
	...ACP_FACTS,
};

function byHarness<T>(
	pick: (facts: HarnessFacts) => T,
): Record<HarnessName, T> {
	return Object.fromEntries(
		Object.entries(HARNESS_FACTS).map(([name, facts]) => [name, pick(facts)]),
	) as Record<HarnessName, T>;
}

/** The display name of each harness, for messages about one that is not added. */
export const HARNESS_LABELS: Record<HarnessName, string> = byHarness(
	(facts) => facts.label,
);

/**
 * The CLI's own command that reopens a session, given its id already quoted
 * for the shell. Null: the CLI has none.
 */
export const HARNESS_TAKE_OVER: Record<
	HarnessName,
	((quotedSessionId: string) => string) | null
> = byHarness((facts) => facts.takeOver);

/**
 * The display name of a harness, for a message about one: its label, or a
 * custom agent's slug (its label lives on the computer that added it).
 */
export function harnessLabel(name: AgentHarnessName): string {
	return isCustomHarness(name) ? customAgentSlug(name) : HARNESS_LABELS[name];
}

/** What a "not added" message calls it: "Cursor harness", "custom agent goose". */
export function harnessNoun(name: AgentHarnessName): string {
	return isCustomHarness(name)
		? `custom agent ${customAgentSlug(name)}`
		: `${HARNESS_LABELS[name]} harness`;
}

/** The port members a harness of this name gets from the table: spread into the adapter. */
export function harnessFacts(
	name: HarnessName,
): Pick<AgentHarness, "label" | "takeOverCommand"> {
	const takeOver = HARNESS_TAKE_OVER[name];
	return {
		label: HARNESS_LABELS[name],
		takeOverCommand: (sessionId) =>
			takeOver ? takeOver(shellQuote(sessionId)) : null,
	};
}
