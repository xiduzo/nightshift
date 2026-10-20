/**
 * The port-side facts about each harness: what `AgentHarness` promises the
 * engine beyond `run`, keyed by name. Every harness adapter (`claude-code.ts`,
 * `codex.ts`, `opencode.ts`, `grok-build.ts`, `acp.ts`) and the fake
 * (`fake.ts`) implement `label` and `takeOverCommand` from this table, so a
 * fake and a real harness are interchangeable at the same seam. The adapter
 * registry (`doctor.ts`, `HARNESS_ADAPTERS`) reads the same table: one source.
 *
 * This module imports no adapter code, so an adapter may import it without
 * a cycle, and the engine may use `HARNESS_LABELS` for a harness it has no
 * instance of (one that is not added).
 */
import type { AgentHarness, HarnessName } from "./types";

/** The display name of each harness, for messages about one that is not added. */
export const HARNESS_LABELS: Record<HarnessName, string> = {
	"claude-code": "Claude Code",
	opencode: "OpenCode",
	codex: "Codex",
	"grok-build": "Grok Build",
	copilot: "GitHub Copilot",
	gemini: "Gemini CLI",
	cursor: "Cursor",
	pi: "pi",
};

/**
 * The CLI's own command that reopens a session, given its id already quoted
 * for the shell. Null: the CLI has none.
 */
export const HARNESS_TAKE_OVER: Record<
	HarnessName,
	((quotedSessionId: string) => string) | null
> = {
	"claude-code": (id) => `claude --resume ${id}`,
	// From the OpenCode CLI docs (`-s, --session`), not checked against 1.x.
	opencode: (id) => `opencode --session ${id}`,
	codex: (id) => `codex resume ${id}`,
	"grok-build": (id) => `grok --resume ${id}`,
	copilot: null,
	gemini: null,
	cursor: (id) => `agent --resume ${id}`,
	// pi-acp's session id is pi's own: `--session` takes it.
	pi: (id) => `pi --session ${id}`,
};

/** Quote one value for a shell, only when it needs it. */
export function shellQuote(value: string): string {
	if (/^[\w@%+=:,./-]+$/.test(value)) return value;
	return `'${value.replaceAll("'", `'\\''`)}'`;
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
