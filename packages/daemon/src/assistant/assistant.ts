import {
	type AgentHarness,
	type AssistantVia,
	chatCanUseTools,
	chatTurn,
	checkAgent,
	explainRun,
	installedSkills,
	resumesOnAnotherModel,
	suggestField,
} from "@nightshift/agents";
import { harnessLabel, harnessNoun } from "@nightshift/agents/harness-facts";
import type {
	AgentErrorKind,
	DecisionInput,
	DecisionResult,
	ValueInput,
	ValueResult,
} from "@nightshift/agents/types";
import type {
	CliToolStore,
	ConnectionStore,
	ProfileStore,
	SettingsStore,
} from "@nightshift/engine/device-config";
import { endedEarly } from "@nightshift/engine/run-status";
import {
	AGENT_ENTRIES,
	type AgentHarnessName,
	type AssistantAgent,
	type AssistantScope,
	type AssistantService,
	BUILTIN_AGENTS,
	type BuiltinAgentId,
	type BuiltinAnswer,
	type BuiltinCheck,
	type BuiltinStatus,
	builtinAgent,
	builtinModel,
	type ChatEvent,
	type ChatRequest,
	canMakeValue,
	chatMessage,
	type DeciderName,
	type ExplanationEvent,
	isAgentProfile,
	type ModelPick,
	valueDecider,
} from "@nightshift/flows";
import { now } from "@nightshift/time";
import {
	type AuthoringSpace,
	authoringPort,
	chatRun,
	historyPort,
} from "./authoring";
import { flowPlace } from "./place";
import {
	type ChatThread,
	createThreadStore,
	keepExchange,
	type ThreadAgent,
	type ThreadStore,
} from "./threads";

/** Where the assistant finds a profile, its harness and the project on this computer. */
export type AssistantDeps = {
	profiles: Pick<ProfileStore, "list">;
	settings: Pick<SettingsStore, "current">;
	/** The harness of that name, when it is added on this computer. */
	harnessFor: (name: AgentHarnessName) => AgentHarness | undefined;
	/** Whether the harness's program is on this computer. */
	installed: (name: AgentHarnessName) => boolean;
	/** The folder of the project's Clone on this computer (in that Space), or null. */
	clonePath: (projectId: string, spaceId?: string) => Promise<string | null>;
	/**
	 * Whether the project has no folder (ADR 22): Suggest and the chat work
	 * for it in the assistant's own folder. Without it: every project has one.
	 */
	withoutFolder?: (projectId: string) => Promise<boolean>;
	/** The engine as the Person sees the Space: the project's flows and runs. */
	space: (scope: AssistantScope) => AuthoringSpace;
	cliTools: Pick<CliToolStore, "list">;
	connections: Pick<ConnectionStore, "list">;
	/** The skills a harness can run in the project. Default: the installed ones. */
	skills?: typeof installedSkills;
	/** The chats. Default: a new store in memory. */
	threads?: ThreadStore;
	/**
	 * An empty folder of the assistant's own, for an explanation of a run
	 * whose project has no Clone here (the run says most of it), and for a
	 * project without a folder. Without it, neither can be answered here.
	 */
	ownFolder?: () => Promise<string>;
	/**
	 * One call to a model of this computer that returns a value in a shape.
	 * The Explainer and the Field writer use it when the person chose a
	 * model for them. Without it, only an agent can answer.
	 */
	decide?: (input: ValueInput) => Promise<ValueResult>;
	/**
	 * One call to a model of this computer that picks one of the labels, as
	 * a Decision in a run asks it. The check of the Decider uses it. Without
	 * it, the check asks for a value, when the model can make one.
	 */
	decideOption?: (input: DecisionInput) => Promise<DecisionResult>;
	/** How long a check waits for its answer. Default: `CHECK_TIMEOUTS`. */
	checkTimeouts?: { agentMs: number; modelMs: number };
};

/** How long a check waits: an agent starts a program first, a model is one call. */
export const CHECK_TIMEOUTS = { agentMs: 60_000, modelMs: 30_000 };

export const NO_CHECK_FOLDER =
	"Night Shift has no folder for the check on this computer. Start Night Shift again, then try again.";

export const NO_CHECK_MODEL =
	"This computer cannot ask this model for a check. Choose another model in Settings.";

/** What the check asks a model that picks an option. */
const CHECK_QUESTION =
	"This is a check that you answer. Pick the option: ready.";
const CHECK_LABELS = [{ name: "ready" }, { name: "not ready" }];

/** What the check asks a model that writes an answer, and the shape it holds it to. */
const CHECK_VALUE_PROMPT =
	'Answer with one JSON object. Set "answer" to the one word: ready.';
const CHECK_OUTPUT = {
	type: "object",
	properties: { answer: { type: "string" } },
	required: ["answer"],
	additionalProperties: false,
};

const seconds = (ms: number) => Math.max(1, Math.round(ms / 1000));

/** What the person can check when a model did not answer. */
function modelHint(decider: DeciderName): string {
	return decider === "ollama"
		? "Check that Ollama runs and has this model."
		: "Check its key and its model in Settings.";
}

/** Words for the person about a model call that failed. */
function modelProblem(
	decider: DeciderName,
	kind: AgentErrorKind,
	message: string,
): string {
	switch (kind) {
		case "aborted":
			return "Stopped.";
		case "usage-limit":
			return "This model reached its usage limit. Try again later, or choose another model in Settings.";
		case "network":
			return "Night Shift could not reach the model. Check the internet connection, then try again.";
		default: {
			const said = message.trim();
			return `The model did not answer. ${said ? `${/[.!?]$/.test(said) ? said : `${said}.`} ` : ""}${modelHint(decider)}`;
		}
	}
}

/**
 * `work` with a time limit: its signal aborts after `ms`, and the wait
 * ends then, also when the work does not stop. "late": the time ran out.
 */
async function within<T>(
	ms: number,
	outer: AbortSignal,
	work: (signal: AbortSignal) => Promise<T>,
): Promise<T | "late"> {
	const limit = new AbortController();
	let timer: ReturnType<typeof setTimeout> | undefined;
	const late = new Promise<"late">((resolve) => {
		timer = setTimeout(() => {
			limit.abort();
			resolve("late");
		}, ms);
	});
	try {
		return await Promise.race([
			work(AbortSignal.any([outer, limit.signal])),
			late,
		]);
	} finally {
		clearTimeout(timer);
	}
}

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

export const NOT_ENDED_EARLY =
	"This run did not stop early, so there is nothing to explain.";

export const NO_RUN = "This run is not in one of your Spaces.";

export const BUSY =
	"The agent still answers your last message. Wait for it, or stop it first.";

/** Whether the request picks an agent itself, rather than the settings' profile. */
function picksAgent(agent: AssistantAgent): boolean {
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
				error: `There is no profile "${requested.profile}" on this computer. Pick another one, or add it on the Agents page.`,
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
function harnessOf(
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
					? `The profile "${picked.profile}" runs on the ${harnessNoun(name)}, which is not added on this computer. Add it on the Agents page, or pick another profile.`
					: `The ${harnessNoun(name)} is not added on this computer. Add it on the Agents page, or choose another harness.`,
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
function chosenAgent(
	id: BuiltinAgentId,
	deps: Pick<AssistantDeps, "settings">,
): AssistantAgent {
	const answer = deps.settings.current().builtinAgents[id];
	if (answer?.kind !== "agent") return {};
	const { kind: _kind, ...agent } = answer;
	return agent;
}

/** Whether two agents are the same: a session on one resumes on the other. */
function sameAgent(a: ThreadAgent, b: ThreadAgent): boolean {
	return (
		a.harness === b.harness && a.model === b.model && a.effort === b.effort
	);
}

/** The daemon's assistant: suggestions and chats on the agent the person picks, read only in the project's Clone. */
export function createAssistant(deps: AssistantDeps): AssistantService {
	const threads = deps.threads ?? createThreadStore();
	const skills = deps.skills ?? installedSkills;

	/**
	 * Where the assistant works for a project: its Clone here, or its own
	 * folder for a project without one (ADR 22). Null: not on this computer.
	 */
	async function workFolder(
		projectId: string,
		spaceId?: string,
	): Promise<string | null> {
		const clone = await deps.clonePath(projectId, spaceId);
		if (clone !== null) return clone;
		if (!deps.ownFolder || !(await deps.withoutFolder?.(projectId))) {
			return null;
		}
		return deps.ownFolder();
	}

	/** The thread a message continues, when it still can. */
	const continued = (request: ChatRequest): ChatThread | null => {
		const thread = request.threadId ? threads.get(request.threadId) : null;
		return thread &&
			thread.projectId === request.projectId &&
			thread.flowName === request.flowName
			? thread
			: null;
	};

	/**
	 * What answers for a built-in agent that gives one report: the agent
	 * the request picks, else what the person chose for it in Settings (an
	 * agent or a model), else the first agent that works. `folder`: where an
	 * agent reads, asked only when an agent answers.
	 */
	async function reportVia(
		id: "explainer" | "field-writer",
		requested: AssistantAgent,
		folder: () => Promise<string | null>,
		none: string,
	): Promise<AssistantVia | { error: string }> {
		const answer: BuiltinAnswer | undefined =
			deps.settings.current().builtinAgents[id];
		if (!picksAgent(requested) && answer?.kind === "model") {
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

	/** Who answers for one built-in agent now, or why nothing can. */
	function statusOf(id: BuiltinAgentId): BuiltinStatus {
		const { takes } = builtinAgent(id);
		const answer = deps.settings.current().builtinAgents[id];
		if (answer?.kind === "model" || takes === "model") {
			// The Decider and the Brief writer with no choice run on TypeSafe.
			const chosen = answer?.kind === "model" ? answer : null;
			const pick = chosen
				? builtinModel(chosen, deps.profiles.list(), {
						values: id !== "decider",
					})
				: { decider: "typesafe" as const };
			if ("problem" in pick) {
				return { id, chosen: true, answers: null, problem: pick.problem };
			}
			return {
				id,
				chosen: chosen !== null,
				answers: {
					kind: "model",
					...(chosen?.profile !== undefined ? { profile: chosen.profile } : {}),
					decider: pick.decider,
					...(pick.model !== undefined ? { model: pick.model } : {}),
				},
				problem: null,
			};
		}
		const tools = takes === "agent-with-tools";
		const picked = pickAgent({}, deps, {
			builtin: id,
			...(tools ? { fits: chatCanUseTools } : {}),
			none: tools ? NO_CHAT_PROFILE : NO_PROFILE,
		});
		if ("error" in picked) {
			return { id, chosen: false, answers: null, problem: picked.error };
		}
		const refusal = tools ? chatRefusal(picked) : null;
		const harness = harnessOf(picked, chosenAgent(id, deps), deps);
		return {
			id,
			chosen: answer?.kind === "agent",
			answers: {
				kind: "agent",
				profile: picked.profile,
				harness: picked.settings.harness,
				model: picked.settings.model,
				...(picked.settings.effort !== undefined
					? { effort: picked.settings.effort }
					: {}),
			},
			problem: refusal ?? ("error" in harness ? harness.error : null),
		};
	}

	/**
	 * The model a run asks for the Decider or the Brief writer, or the model
	 * the person chose for the Explainer or the Field writer. With no choice
	 * a Decision asks TypeSafe, and a Gate's brief asks the first decider
	 * that writes (`valueDecider`), as the engine does.
	 */
	function checkedModel(id: BuiltinAgentId):
		| {
				pick: ModelPick;
				answers: Extract<BuiltinStatus["answers"], { kind: "model" }>;
		  }
		| { problem: string } {
		const answer = deps.settings.current().builtinAgents[id];
		const chosen = answer?.kind === "model" ? answer : null;
		const pick: ModelPick | { problem: string } = chosen
			? builtinModel(chosen, deps.profiles.list(), {
					values: id !== "decider",
				})
			: { decider: id === "decider" ? "typesafe" : valueDecider({}) };
		if ("problem" in pick) return pick;
		return {
			pick,
			answers: {
				kind: "model",
				...(chosen?.profile !== undefined ? { profile: chosen.profile } : {}),
				decider: pick.decider,
				...(pick.model !== undefined ? { model: pick.model } : {}),
			},
		};
	}

	/** One small call to the model of `id`. Null: it answered. Else the problem. */
	async function askModel(
		id: BuiltinAgentId,
		pick: ModelPick,
		signal: AbortSignal,
	): Promise<string | null> {
		const to = {
			decider: pick.decider,
			...(pick.model !== undefined ? { model: pick.model } : {}),
			...(pick.address !== undefined ? { address: pick.address } : {}),
			signal,
		};
		// The Decider picks an option, as a Decision in a run asks it. Without
		// that call, a model that also writes is asked for a value.
		const options = id === "decider" ? deps.decideOption : undefined;
		if (!options && (!deps.decide || !canMakeValue(pick.decider))) {
			// The Explainer and the Field writer can run on an agent instead.
			return deps.decide || builtinAgent(id).takes === "model"
				? NO_CHECK_MODEL
				: NO_MODEL_HERE;
		}
		const timeouts = deps.checkTimeouts ?? CHECK_TIMEOUTS;
		let result: DecisionResult | ValueResult | "late";
		try {
			result = await within<DecisionResult | ValueResult>(
				timeouts.modelMs,
				signal,
				(limited) =>
					options
						? options({
								...to,
								prompt: CHECK_QUESTION,
								labels: CHECK_LABELS,
								signal: limited,
							})
						: (deps.decide as NonNullable<AssistantDeps["decide"]>)({
								...to,
								prompt: CHECK_VALUE_PROMPT,
								output: CHECK_OUTPUT,
								signal: limited,
							}),
			);
		} catch (error) {
			return modelProblem(
				pick.decider,
				"harness",
				error instanceof Error ? error.message : "",
			);
		}
		if (result === "late") {
			return `The model did not answer in ${seconds(timeouts.modelMs)} seconds. ${modelHint(pick.decider)}`;
		}
		if (result.kind !== "error") return null;
		return modelProblem(
			pick.decider,
			signal.aborted ? "aborted" : result.errorKind,
			result.message,
		);
	}

	/**
	 * The check of one built-in agent: one small question to what answers
	 * for it. An agent answers in a read-only session in the assistant's own
	 * folder, with no tools. A model answers in one call.
	 */
	async function check(
		id: BuiltinAgentId,
		signal: AbortSignal,
	): Promise<BuiltinCheck> {
		const started = now();
		const done = (
			answers: BuiltinCheck["answers"],
			problem: string | null,
		): BuiltinCheck => ({
			id,
			ok: problem === null,
			ms: now() - started,
			answers,
			problem,
		});
		try {
			const status = statusOf(id);
			if (builtinAgent(id).takes === "model" || status.answers === null) {
				// A model, or nothing: the status says why nothing can answer.
				if (status.problem !== null) return done(null, status.problem);
				const model = checkedModel(id);
				if ("problem" in model) return done(null, model.problem);
				return done(model.answers, await askModel(id, model.pick, signal));
			}
			if (status.answers.kind === "model") {
				const model = checkedModel(id);
				if ("problem" in model) return done(null, model.problem);
				return done(model.answers, await askModel(id, model.pick, signal));
			}
			const { answers } = status;
			// The status holds the refusal of an agent without Night Shift's
			// tools (the Builder, the Improver) and a harness that is not added.
			if (status.problem !== null) return done(answers, status.problem);
			const label = harnessLabel(answers.harness);
			const harness = deps.harnessFor(answers.harness);
			if (!harness || !deps.installed(answers.harness)) {
				return done(
					answers,
					`Night Shift cannot find ${label} on this computer. Install it, or choose another agent in Settings.`,
				);
			}
			// The same agent as the status names, with its settings as a session takes them.
			const picked = pickAgent({}, deps, {
				builtin: id,
				...(builtinAgent(id).takes === "agent-with-tools"
					? { fits: chatCanUseTools }
					: {}),
			});
			if ("error" in picked) return done(answers, picked.error);
			const cwd = await deps.ownFolder?.();
			if (cwd === undefined) return done(answers, NO_CHECK_FOLDER);
			const timeouts = deps.checkTimeouts ?? CHECK_TIMEOUTS;
			const result = await within(timeouts.agentMs, signal, (limited) =>
				checkAgent({
					harness,
					profile: picked.settings,
					cwd,
					signal: limited,
				}),
			);
			if (result === "late") {
				return done(
					answers,
					`${label} did not answer in ${seconds(timeouts.agentMs)} seconds. Check that you are signed in to it, then try again.`,
				);
			}
			if (result.answered) return done(answers, null);
			return done(
				answers,
				signal.aborted ? "Stopped." : `${label} did not answer. ${result.why}`,
			);
		} catch (error) {
			const said = error instanceof Error ? error.message.trim() : "";
			return done(
				null,
				`The check did not finish. ${said ? `${said} ` : ""}Try again.`,
			);
		}
	}

	return {
		agents: () => BUILTIN_AGENTS.map((agent) => statusOf(agent.id)),
		check,

		async *suggest(request, signal, scope) {
			const via = await reportVia(
				"field-writer",
				request,
				() => workFolder(request.projectId),
				NO_PROFILE,
			);
			if ("error" in via) {
				yield { type: "error", message: via.error };
				return;
			}
			// The answer is checked in the draft's place, as the editor checks it.
			const place = await flowPlace(
				{
					space: deps.space(scope),
					cliTools: deps.cliTools,
					connections: deps.connections,
					withoutFolder: deps.withoutFolder,
				},
				request.projectId,
				request.flowName,
			);
			yield* suggestField({ request, via, place, signal });
		},

		async *chat(request, signal, scope): AsyncGenerator<ChatEvent> {
			const existing = continued(request);
			if (existing?.busy) {
				yield { type: "error", message: BUSY };
				return;
			}
			// The entry names the agent. A chat about a run is the Improver's,
			// and a chat that became the Improver's stays so.
			const entered = request.entry
				? AGENT_ENTRIES[request.entry].agent
				: request.runId
					? "improver"
					: "builder";
			const builtin: "builder" | "improver" =
				existing?.builtin === "improver" || entered === "improver"
					? "improver"
					: "builder";
			// A later message that picks no agent stays on the thread's, unless
			// the thread goes to the other built-in agent.
			const stays =
				existing && existing.builtin === builtin && !picksAgent(request);
			const requested: AssistantAgent = stays ? existing.agent : request;
			const picked = pickAgent(requested, deps, {
				fits: chatCanUseTools,
				none: NO_CHAT_PROFILE,
				builtin,
			});
			if ("error" in picked) {
				yield { type: "error", message: picked.error };
				return;
			}
			const refusal = chatRefusal(picked);
			if (refusal) {
				yield { type: "error", message: refusal };
				return;
			}
			const harness = harnessOf(
				picked,
				picksAgent(requested) ? requested : chosenAgent(builtin, deps),
				deps,
			);
			if ("error" in harness) {
				yield { type: "error", message: harness.error };
				return;
			}
			const cwd = await workFolder(request.projectId, scope.spaceId);
			if (cwd === null) {
				yield { type: "error", message: NO_CLONE };
				return;
			}
			const thread =
				existing ??
				threads.start({
					projectId: request.projectId,
					flowName: request.flowName,
					agent: picked.settings,
					builtin,
				});
			thread.builtin = builtin;
			// Another agent: its session resumes only on the same harness,
			// when that harness takes another model on resume. Else a new
			// session gets the conversation so far.
			if (!sameAgent(thread.agent, picked.settings)) {
				const resumable =
					thread.agent.harness === picked.settings.harness &&
					resumesOnAnotherModel(picked.settings.harness);
				if (!resumable) thread.sessionId = null;
				thread.agent = picked.settings;
			}
			const resume = thread.sessionId;
			const newRun =
				request.runId !== undefined && !thread.runIds.has(request.runId);
			thread.busy = true;
			let answer = "";
			try {
				yield { type: "thread", threadId: thread.id };
				const space = deps.space(scope);
				const port = authoringPort(
					{
						space,
						profiles: deps.profiles,
						cliTools: deps.cliTools,
						connections: deps.connections,
						skills: () => skills(picked.settings.harness, { projectPath: cwd }),
						withoutFolder: deps.withoutFolder,
					},
					request,
					signal,
				);
				for await (const event of chatTurn({
					request,
					agent: builtin,
					harness,
					profile: picked.settings,
					cwd,
					port,
					past: historyPort(space, request, signal),
					...(resume
						? { resumeSessionId: resume, newRun }
						: { history: thread.exchanges }),
					signal,
				})) {
					if (event.type === "session") {
						thread.sessionId = event.sessionId;
						continue;
					}
					if (event.type === "text") answer += event.delta;
					yield event;
				}
				if (request.runId) thread.runIds.add(request.runId);
			} finally {
				keepExchange(thread, {
					message: chatMessage(request) ?? "",
					answer,
				});
				thread.busy = false;
			}
		},

		async *explain(runId, signal, scope): AsyncGenerator<ExplanationEvent> {
			const space = deps.space(scope);
			const detail = await space.getRun(runId).catch(() => null);
			if (!detail) {
				yield { type: "error", message: NO_RUN };
				return;
			}
			if (!endedEarly(detail.status)) {
				yield { type: "error", message: NOT_ENDED_EARLY };
				return;
			}
			// An agent that works here, or a model: the explanation needs no tools.
			const via = await reportVia(
				"explainer",
				{},
				async () =>
					(await deps.clonePath(detail.projectId, scope.spaceId)) ??
					(await deps.ownFolder?.()) ??
					null,
				NO_EXPLAIN_PROFILE,
			);
			if ("error" in via) {
				yield { type: "error", message: via.error };
				return;
			}
			yield { type: "activity", text: "Reads the run" };
			const run = await chatRun(space, detail, signal);
			yield* explainRun({ run, via, signal });
		},
	};
}
