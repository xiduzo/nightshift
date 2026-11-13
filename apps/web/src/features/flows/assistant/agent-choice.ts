import type { AssistantAgent } from "@nightshift/flows";

/**
 * Which agent does the work, as the person picked it in the agent menus:
 * the profile for help (nothing set), an Agent Profile with overrides, or
 * no profile and a harness and model. The owner of the menus keeps it.
 */
export type AgentChoice = AssistantAgent;

/**
 * The request's agent fields for a choice. Without a profile, a blank
 * model is the harness's default model (`defaultModel`), as its field
 * shows; a blank model on a profile is no override.
 */
export function requestAgent(
	choice: AgentChoice,
	defaultModel: (harness: NonNullable<AgentChoice["harness"]>) => string,
): AssistantAgent {
	const model = choice.model?.trim() || undefined;
	if (choice.profile !== undefined) {
		return {
			profile: choice.profile,
			...(choice.harness ? { harness: choice.harness } : {}),
			...(model ? { model } : {}),
			...(choice.effort ? { effort: choice.effort } : {}),
		};
	}
	if (choice.harness === undefined) return {};
	return {
		harness: choice.harness,
		model: model ?? defaultModel(choice.harness),
		...(choice.effort ? { effort: choice.effort } : {}),
	};
}

type Harness = NonNullable<AgentChoice["harness"]>;

/**
 * The choice after the person picks `model` on `harness` in the agent
 * menu. With a profile in use (`profile`: the one picked, or the profile
 * for help), the pick overrides the profile's model, and its harness when
 * that is another one. Without a profile, the harness and model answer.
 * The effort stays.
 */
export function pickModel(
	choice: AgentChoice,
	pick: { harness: Harness; model: string },
	profile: { name: string; harness?: Harness } | undefined,
): AgentChoice {
	const effort = choice.effort ? { effort: choice.effort } : {};
	const usesProfile =
		choice.profile !== undefined ||
		(choice.harness === undefined && profile !== undefined);
	if (!usesProfile)
		return { harness: pick.harness, model: pick.model, ...effort };
	return {
		profile: choice.profile ?? profile?.name ?? "",
		...(pick.harness !== profile?.harness ? { harness: pick.harness } : {}),
		model: pick.model,
		...effort,
	};
}

/** The choice without its harness and model overrides: the profile's model answers again. */
export function profileModel({
	harness: _,
	model: __,
	...rest
}: AgentChoice): AgentChoice {
	return rest;
}
