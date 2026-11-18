import {
	type AgentHarness,
	type AssistantVia,
	chatCanUseTools,
} from "@nightshift/agents";
import { harnessLabel, harnessNoun } from "@nightshift/agents/harness-facts";
import {
	type AgentHarnessName,
	type AssistantAgent,
	type BuiltinAgentId,
	type BuiltinAnswer,
	type BuiltinModelAnswer,
	builtinAgent,
	builtinModel,
	isAgentProfile,
} from "@nightshift/flows";
import type { AssistantDeps } from "./assistant-deps";
import type { ThreadAgent } from "./threads";

/**
 * Who answers for the assistant: the agent a request picks, else what the
 * person chose in Settings, else the first agent that works on this
 * computer. With the words for the person when there is none.
 */

/**
 * The agent that answers: a profile's harness, model and effort with the
 * request's overrides on top, or the harness and model the request picks.
 * `profile` is null for the second.
 */
export type PickedAgent = { profile: string | null; settings: ThreadAgent };

export const NO_PROFILE =
	"No agent can make suggestions on this computer. Add an agent in Settings, or choose a model for the Field writer.";

export const NO_CHAT_PROFILE =
	"No agent can chat on this computer. Add an agent in Settings that uses Claude Code, Codex or OpenCode.";

export const NO_CLONE =
	"This project is not on this computer. Add its folder here, then ask again.";

export const NO_EXPLAIN_PROFILE =
	"No agent can answer on this computer. Add an agent in Settings, or choose a model for the Explainer.";

export const NO_MODEL_HERE =
	"This computer cannot ask a model. Choose an agent in Settings.";

/** Whether the request picks an agent itself, rather than the settings' profile. */
export function picksAgent(agent: AssistantAgent): boolean {
	return (
		agent.profile !== undefined ||
		agent.harness !== undefined ||
		agent.model !== undefined ||
		agent.effort !== undefined
	);
}

/** Why a chat cannot run on this agent, or null. */
export function chatRefusal(picked: PickedAgent): string | null {
	const { harness } = picked.settings;
	if (chatCanUseTools(harness)) return null;
	return picked.profile !== null
		? `The chat cannot use the profile "${picked.profile}". ${harnessLabel(harness)} cannot read your flow or propose changes. Choose an agent in Settings that uses Claude Code, Codex or OpenCode.`
		: `The chat cannot use ${harnessLabel(harness)}. It cannot read your flow or propose changes. Choose Claude Code, Codex or OpenCode in Settings.`;
}

/**
 * The agent the assistant runs on, as an Agent node picks its agent: the
 * request's profile with its overrides, else the request's own harness and
 * model. A request that picks nothing gets the profile in the settings
 * ("Profile for help"), else the first profile whose harness is added and
 * installed here. With `fits`, the setting and the first profile count
 * only when their harness fits; an agent the request picks always counts,
 * so the caller can say why it does not fit. A message for the person when
 * there is none.
 */
export function pickAgent(
	requested: AssistantAgent,
	deps: Pick<
		AssistantDeps,
		"profiles" | "settings" | "harnessFor" | "installed"
	>,
	fallback: {
		fits?: (harness: AgentHarnessName) => boolean;
		none?: string;
		/**
		 * The built-in agent that answers. A request that picks nothing gets
		 * the agent the person chose for it in Settings, when that one still
		 * works here. Then the profile for help, then the first that works.
		 */
		builtin?: BuiltinAgentId;
	} = {},
): PickedAgent | { error: string } {
	// The assistant runs on an Agent Profile only.
	const all = deps.profiles.list().filter(isAgentProfile);
	const named = (name: string): PickedAgent | null => {
		const found = all.find((profile) => profile.name === name);
		if (!found) return null;
		const settings: ThreadAgent = {
			harness: found.harness,
			model: found.model,
		};
		if (found.effort !== undefined) settings.effort = found.effort;
		return { profile: name, settings };
	};
	if (requested.profile !== undefined) {
		const picked = named(requested.profile);
		if (!picked) {
			return {
				error: `There is no profile "${requested.profile}" on this computer. Pick another one, or add it in Settings.`,
			};
		}
		// The request's own fields win over the profile, as on an Agent node.
		return { profile: picked.profile, settings: overrides(picked, requested) };
	}
	if (requested.harness !== undefined && requested.model !== undefined) {
		const settings: ThreadAgent = {
			harness: requested.harness,
			model: requested.model,
		};
		if (requested.effort !== undefined) settings.effort = requested.effort;
		return { profile: null, settings };
	}
	if (picksAgent(requested)) {
		return { error: "Choose a profile, or a harness and a model." };
	}
	const answer = fallback.builtin
		? deps.settings.current().builtinAgents[fallback.builtin]
		: undefined;
	if (answer?.kind === "agent") {
		const { kind: _kind, ...own } = answer;
		// The agent the person chose, as a request would pick it. One that is
		// gone falls back, as the profile for help does.
		const picked = pickAgent(own, deps);
		if (!("error" in picked)) return picked;
	}
	const chosen = deps.settings.current().assistantProfile.trim();
	const fits = (harness: AgentHarnessName) => fallback.fits?.(harness) ?? true;
	// A profile in the settings that is gone, or does not fit, falls back to
	// the first that works.
	const fromSettings = chosen ? named(chosen) : null;
	if (fromSettings && fits(fromSettings.settings.harness)) return fromSettings;
	const ready = all.find(
		(profile) =>
			deps.harnessFor(profile.harness) !== undefined &&
			deps.installed(profile.harness) &&
			fits(profile.harness),
	);
	return ready
		? (named(ready.name) as PickedAgent)
		: { error: fallback.none ?? NO_PROFILE };
}

/** A profile's settings with the request's own harness, model and effort on top. */
function overrides(
	picked: PickedAgent,
	requested: AssistantAgent,
): ThreadAgent {
	const settings: ThreadAgent = {
		harness: requested.harness ?? picked.settings.harness,
		model: requested.model ?? picked.settings.model,
	};
	const effort = requested.effort ?? picked.settings.effort;
	if (effort !== undefined) settings.effort = effort;
	return settings;
}

/**
 * The harness the agent runs on, or a message for the person. A harness
 * the person picked must also be installed here; a profile's own harness
 * fails later with the harness's own words, as in a run.
 */
export function harnessOf(
	picked: PickedAgent,
	requested: AssistantAgent,
	deps: Pick<AssistantDeps, "harnessFor" | "installed">,
): AgentHarness | { error: string } {
	const name = picked.settings.harness;
	const own = requested.harness !== undefined;
	const harness = deps.harnessFor(name);
	if (!harness) {
		return {
			error:
				picked.profile !== null && !own
					? `The profile "${picked.profile}" runs on the ${harnessNoun(name)}, which is not added on this computer. Add it in Settings, or pick another profile.`
					: `The ${harnessNoun(name)} is not added on this computer. Add it in Settings, or choose another harness.`,
		};
	}
	if (own && !deps.installed(name)) {
		return {
			error: `Night Shift cannot find ${harnessLabel(name)} on this computer. Install it, or choose another harness.`,
		};
	}
	return harness;
}

/** The agent the person chose in Settings for `id`, as a request names an agent. Empty: none. */
export function chosenAgent(
	id: BuiltinAgentId,
	deps: Pick<AssistantDeps, "settings">,
): AssistantAgent {
	const answer = deps.settings.current().builtinAgents[id];
	if (answer?.kind !== "agent") return {};
	const { kind: _kind, ...agent } = answer;
	return agent;
}

/** Whether two agents are the same: a session on one resumes on the other. */
export function sameAgent(a: ThreadAgent, b: ThreadAgent): boolean {
	return (
		a.harness === b.harness && a.model === b.model && a.effort === b.effort
	);
}

/** The built-in agents that give one report: an agent or a model answers. */
export type ReportAgent = "explainer" | "field-writer" | "learner";

export const NO_LEARNER =
	"No agent can look back at runs on this computer. Add an agent in Settings, or choose a model for the Learner.";

/**
 * What answers for a built-in agent that gives one report: the model or
 * the agent the request picks, else what the person chose for it in
 * Settings (an agent or a model), else the first agent that works.
 * `folder`: where an agent reads, asked only when an agent answers.
 */
export async function reportAgentVia(
	deps: Pick<
		AssistantDeps,
		"settings" | "profiles" | "decide" | "harnessFor" | "installed"
	>,
	id: ReportAgent,
	requested: AssistantAgent & { modelAnswer?: BuiltinModelAnswer },
	folder: () => Promise<string | null>,
	none: string,
): Promise<AssistantVia | { error: string }> {
	const answer: BuiltinAnswer | undefined =
		requested.modelAnswer ??
		(picksAgent(requested)
			? undefined
			: deps.settings.current().builtinAgents[id]);
	if (answer?.kind === "model") {
		const { decide } = deps;
		if (!decide) return { error: NO_MODEL_HERE };
		const pick = builtinModel(answer, deps.profiles.list(), {
			values: true,
		});
		if ("problem" in pick) return { error: pick.problem };
		return {
			kind: "model",
			ask: ({ prompt, output, signal }) =>
				decide({
					decider: pick.decider,
					prompt,
					output,
					...(pick.model !== undefined ? { model: pick.model } : {}),
					...(pick.address !== undefined ? { address: pick.address } : {}),
					signal,
				}),
		};
	}
	const picked = pickAgent(requested, deps, { builtin: id, none });
	if ("error" in picked) return picked;
	const harness = harnessOf(
		picked,
		picksAgent(requested) ? requested : chosenAgent(id, deps),
		deps,
	);
	if ("error" in harness) return harness;
	const cwd = await folder();
	if (cwd === null) return { error: NO_CLONE };
	return {
		kind: "agent",
		harness,
		profile: picked.settings,
		cwd,
		limits: builtinAgent(id).limits,
	};
}
