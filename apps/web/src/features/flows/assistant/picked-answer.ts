/**
 * The fields of a request that say who answers one ask of one of Night
 * Shift's own agents: the default from Settings, or the person's pick.
 */
import type {
	AssistantAgent,
	BuiltinAnswer,
	BuiltinModelAnswer,
	BuiltinStatus,
} from "@nightshift/flows";
import { type AgentChoice, requestAgent } from "./agent-choice";

/** What the person picked: an agent, or a model by its value in the menu (`answerOfModel`). */
export type AnswerPick =
	| { agent: AgentChoice }
	| { model: BuiltinAnswer | null };

/** The fields of a request that say who answers. Empty: the computer decides. */
export type PickedAnswer = AssistantAgent & {
	modelAnswer?: BuiltinModelAnswer;
};

/**
 * The request's fields for the default: the answer saved in Settings, else
 * what the computer uses now. Sent as a pick, so a chat that had another
 * agent comes back to the default, and what the menu shows is what answers.
 */
export function defaultRequest(
	saved: BuiltinAnswer | undefined,
	status: BuiltinStatus | undefined,
): PickedAnswer {
	if (saved) {
		const { kind: _, ...rest } = saved;
		return saved.kind === "model" ? { modelAnswer: saved } : rest;
	}
	const now = status?.answers;
	if (!now) return {};
	if (now.kind === "model") {
		return {
			modelAnswer: {
				kind: "model",
				...(now.profile !== undefined
					? { profile: now.profile }
					: {
							decider: now.decider,
							...(now.model !== undefined ? { model: now.model } : {}),
						}),
			},
		};
	}
	if (now.profile !== null) return { profile: now.profile };
	return {
		harness: now.harness,
		model: now.model,
		...(now.effort
			? { effort: now.effort as NonNullable<AssistantAgent["effort"]> }
			: {}),
	};
}

/** The request's fields for a pick. */
export function overrideRequest(
	pick: AnswerPick,
	defaultModel: (harness: NonNullable<AgentChoice["harness"]>) => string,
): PickedAnswer {
	if ("agent" in pick) return requestAgent(pick.agent, defaultModel);
	return pick.model?.kind === "model" ? { modelAnswer: pick.model } : {};
}
