/**
 * The check of an agent: one small question in a read-only session.
 */
import type { AgentProfileSettings } from "@nightshift/flows";
import type { AgentHarness } from "../../port";
import type { AgentCheck } from "../catalog";
import { CHECK_LIMITS, CHECK_PROMPT } from "../catalog";
import { AT_LIMIT, type Sessions } from "../sessions";

export const checkAgent =
	(ports: Pick<Sessions, "runSession">) =>
	async (input: {
		harness: AgentHarness;
		profile: Pick<AgentProfileSettings, "model" | "effort">;
		cwd: string;
		signal: AbortSignal;
	}): Promise<AgentCheck> => {
		let text = "";
		for await (const event of ports.runSession({
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
	};
