import {
	type AgentHarness,
	chatCanUseTools,
	chatTurn,
	installedSkills,
	resumesOnAnotherModel,
	suggestField,
} from "@nightshift/agents";
import { harnessLabel, harnessNoun } from "@nightshift/agents/harness-facts";
import type {
	CliToolStore,
	ConnectionStore,
	ProfileStore,
	SettingsStore,
} from "@nightshift/engine";
import type {
	AgentHarnessName,
	AssistantAgent,
	AssistantScope,
	AssistantService,
	ChatEvent,
	ChatRequest,
} from "@nightshift/flows";
import { authoringPort, type ChatSpace } from "./authoring";
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
	/** The engine as the Person sees the Space: the project's flows and runs. */
	space: (scope: AssistantScope) => ChatSpace;
	cliTools: Pick<CliToolStore, "list">;
	connections: Pick<ConnectionStore, "list">;
	/** The skills a harness can run in the project. Default: the installed ones. */
	skills?: typeof installedSkills;
	/** The chats. Default: a new store in memory. */
	threads?: ThreadStore;
};

/**
 * The agent that answers: a profile's harness, model and effort with the
 * request's overrides on top, or the harness and model the request picks.
 * `profile` is null for the second.
 */
export type PickedAgent = { profile: string | null; settings: ThreadAgent };

export const NO_PROFILE =
	"No profile can make suggestions on this computer. Add a profile on the Agents page, with a harness that is installed here.";

export const NO_CHAT_PROFILE =
	"No profile can chat on this computer. Add a profile on the Agents page that uses Claude Code, Codex or OpenCode.";

export const NO_CLONE =
	"This project is not on this computer. Add its folder here, then ask again.";

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
		? `The chat cannot use the profile "${picked.profile}": ${harnessLabel(harness)} cannot read your flow or propose changes. Choose a profile that uses Claude Code, Codex or OpenCode for the chat.`
		: `The chat cannot use ${harnessLabel(harness)}: it cannot read your flow or propose changes. Choose Claude Code, Codex or OpenCode for the chat.`;
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
	} = {},
): PickedAgent | { error: string } {
	const all = deps.profiles.list();
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

	/** The thread a message continues, when it still can. */
	const continued = (request: ChatRequest): ChatThread | null => {
		const thread = request.threadId ? threads.get(request.threadId) : null;
		return thread &&
			thread.projectId === request.projectId &&
			thread.flowName === request.flowName
			? thread
			: null;
	};

	return {
		async *suggest(request, signal) {
			const picked = pickAgent(request, deps);
			if ("error" in picked) {
				yield { type: "error", message: picked.error };
				return;
			}
			const harness = harnessOf(picked, request, deps);
			if ("error" in harness) {
				yield { type: "error", message: harness.error };
				return;
			}
			const cwd = await deps.clonePath(request.projectId);
			if (cwd === null) {
				yield { type: "error", message: NO_CLONE };
				return;
			}
			yield* suggestField({
				request,
				harness,
				profile: picked.settings,
				cwd,
				signal,
			});
		},

		async *chat(request, signal, scope): AsyncGenerator<ChatEvent> {
			const existing = continued(request);
			if (existing?.busy) {
				yield { type: "error", message: BUSY };
				return;
			}
			// A later message that picks no agent stays on the thread's.
			const requested: AssistantAgent =
				existing && !picksAgent(request) ? existing.agent : request;
			const picked = pickAgent(requested, deps, {
				fits: chatCanUseTools,
				none: NO_CHAT_PROFILE,
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
			const harness = harnessOf(picked, requested, deps);
			if ("error" in harness) {
				yield { type: "error", message: harness.error };
				return;
			}
			const cwd = await deps.clonePath(request.projectId, scope.spaceId);
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
				});
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
				const port = authoringPort(
					{
						space: deps.space(scope),
						profiles: deps.profiles,
						cliTools: deps.cliTools,
						connections: deps.connections,
						skills: () => skills(picked.settings.harness, { projectPath: cwd }),
					},
					request,
					signal,
				);
				for await (const event of chatTurn({
					request,
					harness,
					profile: picked.settings,
					cwd,
					port,
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
				keepExchange(thread, { message: request.message, answer });
				thread.busy = false;
			}
		},
	};
}
