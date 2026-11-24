import type { AgentProfileSettings, ExplanationEvent } from "@nightshift/flows";
import type { AgentHarness, ValueResult } from "../../port";
import { explanationPrompt } from "../catalog";
import { type AuthoringRun, runReport } from "../domain/authoring";
import type { SessionLimits } from "../domain/session";
import type { AssistantSessions } from "./ports";

const ANSWER_LIMIT = 1_200;

/** An agent of this computer answers: a read-only session in a folder. */
export type AgentVia = {
	kind: "agent";
	harness: AgentHarness;
	profile: Pick<AgentProfileSettings, "model" | "effort">;
	cwd: string;
	limits?: SessionLimits;
};

/** A model answers: one call that returns the report. */
export type ModelVia = {
	kind: "model";
	ask: (input: {
		prompt: string;
		output: Record<string, unknown>;
		signal: AbortSignal;
	}) => Promise<ValueResult>;
};

/** What answers for a built-in agent that gives one report. */
export type AssistantVia = AgentVia | ModelVia;

export type ExplainRunInput = {
	run: AuthoringRun;
	via: AssistantVia;
	signal: AbortSignal;
};

export const explainRun = (ports: {
	sessions: Pick<AssistantSessions, "runReport">;
}) =>
	async function* (input: ExplainRunInput): AsyncGenerator<ExplanationEvent> {
		for await (const event of ports.sessions.runReport(input.via, {
			prompt: explanationPrompt(
				runReport(input.run, input.run.flow, "The flow"),
			),
			report: {},
			signal: input.signal,
		})) {
			switch (event.type) {
				case "activity":
				case "usage":
					yield event;
					break;
				case "error":
					yield { type: "error", message: event.message };
					return;
				case "end": {
					const answer = plain(event.report?.summary || event.text);
					if (answer === "") {
						yield {
							type: "error",
							message: "The agent stopped without an answer. Ask again.",
						};
						return;
					}
					yield { type: "answer", answer };
					yield { type: "done" };
					return;
				}
				default:
					break;
			}
		}
	};

function plain(text: string): string {
	const flat = text
		.replace(/\*\*|__|`/g, "")
		.replace(/^#+\s*/gm, "")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
	return flat.length > ANSWER_LIMIT
		? `${flat.slice(0, ANSWER_LIMIT - 1).trimEnd()}…`
		: flat;
}
