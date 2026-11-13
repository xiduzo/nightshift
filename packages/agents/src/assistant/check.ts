/**
 * The check of an agent: one small question in a read-only session, with no
 * tools, to prove that the agent answers on this computer. It costs little:
 * a few words, at most two turns and a few cents.
 */
import type { AgentProfileSettings } from "@nightshift/flows";
import type { AgentHarness } from "../port";
import { AT_LIMIT, runAssistantSession, type SessionLimits } from "./session";

/** What the check asks. Any answer in text counts. */
export const CHECK_PROMPT = "Answer with the one word: ready.";

/** The most the check of an agent may use. */
export const CHECK_LIMITS: Required<SessionLimits> = { turns: 2, usd: 0.1 };

/** Whether the agent answered, or what stopped it, in words for the person. */
export type AgentCheck = { answered: true } | { answered: false; why: string };

/**
 * Asks an agent the check question in `cwd`. Never throws. Aborting
 * `signal` stops the session: the result then says "Stopped.".
 */
export async function checkAgent(input: {
	harness: AgentHarness;
	profile: Pick<AgentProfileSettings, "model" | "effort">;
	cwd: string;
	signal: AbortSignal;
}): Promise<AgentCheck> {
	let text = "";
	for await (const event of runAssistantSession({
		...input,
		prompt: CHECK_PROMPT,
		limits: CHECK_LIMITS,
	})) {
		if (event.type === "text") text += event.delta;
		if (event.type === "end") {
			return event.text.trim() !== "" || text.trim() !== ""
				? { answered: true }
				: { answered: false, why: "The agent stopped without an answer." };
		}
		if (event.type === "error") {
			// An answer that came before the limit is still an answer.
			if (event.message === AT_LIMIT && text.trim() !== "") {
				return { answered: true };
			}
			return { answered: false, why: event.message };
		}
	}
	return { answered: false, why: "The agent stopped without an answer." };
}
