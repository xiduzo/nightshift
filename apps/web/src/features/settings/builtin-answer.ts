/**
 * Who answers for one of Night Shift's own agents, between its two shapes:
 * the saved answer (`builtinAgents` of the settings) and what the agent
 * picker holds (an agent choice, or the value of a model in its list).
 */
import {
	type AssistantAgent,
	type BuiltinAgent,
	type BuiltinAnswer,
	type BuiltinStatus,
	type BuiltinTakes,
	deciderNameSchema,
} from "@nightshift/flows";

/** What can answer for an agent, in words. */
export const TAKES_LABEL: Record<BuiltinTakes, string> = {
	"agent-with-tools": "An agent",
	either: "An agent or a model",
	model: "A model",
};

/** A model in the picker's list: a Model Profile, or a decider of this computer. */
const PROFILE = "profile:";
const DECIDER = "decider:";

export const profileValue = (name: string) => `${PROFILE}${name}`;
export const deciderValue = (name: string) => `${DECIDER}${name}`;

/** The decider that a value of the list names. Undefined: it names none. */
export function deciderOfValue(value: string) {
	if (!value.startsWith(DECIDER)) return undefined;
	const decider = deciderNameSchema.safeParse(value.slice(DECIDER.length));
	return decider.success ? decider.data : undefined;
}

/** The answer for a model picked in the list. Null: the value names no model. */
export function answerOfModel(value: string): BuiltinAnswer | null {
	if (value.startsWith(PROFILE)) {
		const profile = value.slice(PROFILE.length);
		return profile ? { kind: "model", profile } : null;
	}
	const decider = deciderOfValue(value);
	return decider ? { kind: "model", decider } : null;
}

/**
 * The answer for an agent picked in the picker: a profile with what the
 * person changed on it, or a harness and a model. Null: nothing is picked,
 * so this computer chooses.
 */
export function answerOfAgent(agent: AssistantAgent): BuiltinAnswer | null {
	if (agent.profile !== undefined) {
		return {
			kind: "agent",
			profile: agent.profile,
			...(agent.harness ? { harness: agent.harness } : {}),
			...(agent.model ? { model: agent.model } : {}),
			...(agent.effort ? { effort: agent.effort } : {}),
		};
	}
	if (agent.harness === undefined || !agent.model) return null;
	return {
		kind: "agent",
		harness: agent.harness,
		model: agent.model,
		...(agent.effort ? { effort: agent.effort } : {}),
	};
}

/** What the picker shows: an agent choice, or the model that answers. */
export type ShownAnswer = {
	agent: AssistantAgent;
	/** The value of the model in the list. Undefined: an agent answers. */
	model: string | undefined;
};

const NOTHING: ShownAnswer = { agent: {}, model: undefined };

/**
 * What the picker shows for an agent: the saved answer, else what this
 * computer uses now (`status`), else nothing.
 */
export function shownAnswer(
	saved: BuiltinAnswer | undefined,
	status: BuiltinStatus | undefined,
): ShownAnswer {
	if (saved) {
		if (saved.kind === "model") {
			if (saved.profile !== undefined)
				return { agent: {}, model: profileValue(saved.profile) };
			return saved.decider !== undefined
				? { agent: {}, model: deciderValue(saved.decider) }
				: NOTHING;
		}
		const { kind: _, ...agent } = saved;
		return { agent, model: undefined };
	}
	const now = status?.answers;
	if (!now) return NOTHING;
	if (now.kind === "model") {
		return {
			agent: {},
			model:
				now.profile !== undefined
					? profileValue(now.profile)
					: deciderValue(now.decider),
		};
	}
	// A profile gives its own harness, model and effort.
	if (now.profile !== null)
		return { agent: { profile: now.profile }, model: undefined };
	return {
		agent: {
			harness: now.harness,
			model: now.model,
			...(now.effort ? { effort: now.effort as AssistantAgent["effort"] } : {}),
		},
		model: undefined,
	};
}

/** The most one answer of an agent may use: "$2.00 · 40 turns", or "One call" for a model. */
export function limitText(limits: BuiltinAgent["limits"]): string {
	const parts = [
		limits.usd !== undefined ? `$${limits.usd.toFixed(2)}` : null,
		limits.turns !== undefined
			? `${limits.turns} ${limits.turns === 1 ? "turn" : "turns"}`
			: null,
	].filter(Boolean);
	return parts.length > 0 ? parts.join(" · ") : "One call";
}
