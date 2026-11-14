/**
 * Who answers "Ask why" on the phone: the Explainer's default on the Host,
 * or another of the Host's agents or models for this ask, with an effort.
 * The same choice as the menus beside "Ask why" on the desktop.
 */
import {
	type BuiltinStatus,
	deciderNameSchema,
	type ExplainRequest,
	effortSchema,
} from "@nightshift/flows";

/** The value of the default in both pickers. */
export const DEFAULT = "default";

type Option = { value: string; label: string };

/** A profile of the Host: an agent (a harness) or a model (a decider). */
type ProfileRow = { name: string; harness?: string; decider?: string };

/** What answers by default, in a few words: "opus", "sonnet", "Ollama · gemma". */
function defaultLabel(status: BuiltinStatus | undefined): string | null {
	const now = status?.answers;
	if (!now) return null;
	if (now.profile) return now.profile;
	return now.kind === "agent"
		? now.model
		: [now.decider, now.model].filter(Boolean).join(" · ");
}

/** The options of "Answers with": the default, then the Host's agents and models. */
export function answerOptions(
	status: BuiltinStatus | undefined,
	profiles: readonly ProfileRow[],
	deciders: readonly { name: string; label: string }[],
): Option[] {
	const label = defaultLabel(status);
	return [
		{ value: DEFAULT, label: label ? `Default · ${label}` : "Default" },
		...profiles
			.filter((profile) => profile.harness !== undefined)
			.map((profile) => ({
				value: `agent:${profile.name}`,
				label: profile.name,
			})),
		...profiles
			.filter((profile) => profile.decider !== undefined)
			.map((profile) => ({
				value: `model:${profile.name}`,
				label: profile.name,
			})),
		...deciders.map((decider) => ({
			value: `decider:${decider.name}`,
			label: decider.label,
		})),
	];
}

/** The options of "Effort": the default, then each effort. */
export const EFFORT_OPTIONS: Option[] = [
	{ value: DEFAULT, label: "Default" },
	...effortSchema.options.map((effort) => ({ value: effort, label: effort })),
];

/** Whether the answer works in turns, so an effort counts. A model has none. */
export function takesEffort(
	answer: string,
	status: BuiltinStatus | undefined,
): boolean {
	if (answer === DEFAULT) return status?.answers?.kind === "agent";
	return answer.startsWith("agent:");
}

/**
 * The fields of the ask for a choice. The default with no effort sends
 * nothing: the Host answers with its own choice in Settings.
 */
export function askWhyPick(
	answer: string,
	effortValue: string,
	status: BuiltinStatus | undefined,
): Omit<ExplainRequest, "runId"> {
	const parsed = effortSchema.safeParse(effortValue);
	const effort =
		parsed.success && takesEffort(answer, status)
			? { effort: parsed.data }
			: {};
	const [kind, ...rest] = answer.split(":");
	const name = rest.join(":");
	if (kind === "agent" && name) return { profile: name, ...effort };
	if (kind === "model" && name)
		return { modelAnswer: { kind: "model", profile: name } };
	if (kind === "decider") {
		const decider = deciderNameSchema.safeParse(name);
		return decider.success
			? { modelAnswer: { kind: "model", decider: decider.data } }
			: {};
	}
	const now = status?.answers;
	if (!("effort" in effort) || now?.kind !== "agent") return {};
	return now.profile !== null
		? { profile: now.profile, ...effort }
		: { harness: now.harness, model: now.model, ...effort };
}
