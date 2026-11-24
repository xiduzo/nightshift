import type { AgentProfileSettings } from "@nightshift/flows";
import type { AgentHarness, ValueResult } from "../../../port";
import {
	type AssistantSessionEvent,
	type SessionLimits,
	sessionErrorMessage,
} from "../domain/session";
import type { runSession } from "./run-session";

/** An agent of this computer answers: a read-only session in a folder. */
export type AgentVia = {
	kind: "agent";
	/** The harness that answers, as this computer runs it. */
	harness: AgentHarness;
	profile: Pick<AgentProfileSettings, "model" | "effort">;
	/** The project's Clone on this computer, or a folder of the assistant's own. */
	cwd: string;
	limits?: SessionLimits;
};

/** A model answers: one call that returns the report, with no tools and no files. */
export type ModelVia = {
	kind: "model";
	ask: (input: {
		prompt: string;
		/** A JSON Schema the answer is held to. */
		output: Record<string, unknown>;
		signal: AbortSignal;
	}) => Promise<ValueResult>;
};

/**
 * What answers for a built-in agent that gives one report (the Explainer,
 * the Field writer): one of the person's agents, or one of their models.
 * The prompt and the shape of the answer are the same for both.
 */
export type AssistantVia = AgentVia | ModelVia;

/** What a model is told on top of the prompt of an agent. */
const MODEL_NOTE = [
	"",
	"---",
	"",
	"You cannot read files or call tools. Work with what is above only.",
	"Answer with one JSON object. `summary` is the summary of your step report. `data`, when asked for, is its data.",
].join("\n");

/** The JSON Schema of a step report as one model call returns it. */
function reportSchema(
	output: Record<string, unknown> | undefined,
): Record<string, unknown> {
	return {
		type: "object",
		properties: {
			summary: { type: "string" },
			...(output ? { data: output } : {}),
		},
		required: output ? ["summary", "data"] : ["summary"],
		additionalProperties: false,
	};
}

/**
 * One report for one prompt, from an agent session or from one model
 * call, as the events of a session. A model has no session to resume: it
 * ends with an empty `sessionId`. Never throws.
 */
export const runReport = (ports: {
	runSession: ReturnType<typeof runSession>;
}) =>
	async function* (
		via: AssistantVia,
		input: {
			prompt: string;
			report: { output?: Record<string, unknown> };
			resumeSessionId?: string;
			signal: AbortSignal;
		},
	): AsyncGenerator<AssistantSessionEvent> {
		if (via.kind === "agent") {
			yield* ports.runSession({
				harness: via.harness,
				profile: via.profile,
				cwd: via.cwd,
				prompt: input.prompt,
				report: input.report,
				...(input.resumeSessionId
					? { resumeSessionId: input.resumeSessionId }
					: {}),
				...(via.limits ? { limits: via.limits } : {}),
				signal: input.signal,
			});
			return;
		}
		yield { type: "activity", text: "Asks the model" };
		let result: ValueResult;
		try {
			result = await via.ask({
				prompt: `${input.prompt}\n${MODEL_NOTE}`,
				output: reportSchema(input.report.output),
				signal: input.signal,
			});
		} catch (error) {
			yield {
				type: "error",
				message: error instanceof Error ? error.message : "The model failed.",
				sessionId: null,
			};
			return;
		}
		if (result.costUsd !== null) {
			yield {
				type: "usage",
				usage: { inputTokens: 0, outputTokens: 0, costUsd: result.costUsd },
			};
		}
		if (result.kind === "error") {
			yield {
				type: "error",
				message: sessionErrorMessage(
					input.signal.aborted ? "aborted" : result.errorKind,
					result.message,
				),
				sessionId: null,
			};
			return;
		}
		const data =
			typeof result.data === "object" && result.data !== null
				? (result.data as { summary?: unknown; data?: unknown })
				: {};
		const summary = typeof data.summary === "string" ? data.summary : "";
		yield {
			type: "end",
			sessionId: "",
			report: {
				summary,
				...(data.data !== undefined ? { data: data.data } : {}),
			},
			text: summary,
		};
	};
