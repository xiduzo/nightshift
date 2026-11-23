/**
 * The check of an agent: one small question in a read-only session.
 */
import type { AgentProfileSettings } from "@nightshift/flows";
import type { AgentHarness } from "../../port";
import { CHECK_LIMITS, CHECK_PROMPT } from "../domain/check-limits";
import { AT_LIMIT } from "../domain/session";
import type { AssistantSessions } from "./ports";

export const checkAgent =
	(ports: { sessions: Pick<AssistantSessions, "run"> }) =>
	async (input: {
		harness: AgentHarness;
		profile: Pick<AgentProfileSettings, "model" | "effort">;
		cwd: string;
		signal: AbortSignal;
	}): Promise<import("../domain/check-agent").AgentCheck> => {
		let text = "";
		for await (const event of ports.sessions.run({
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
				if (event.message === AT_LIMIT && text.trim() !== "") {
					return { answered: true };
				}
				return { answered: false, why: event.message };
			}
		}
		return { answered: false, why: "The agent stopped without an answer." };
	};