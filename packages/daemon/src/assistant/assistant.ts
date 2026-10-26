import {
	type AgentHarness,
	chatCanUseTools,
	chatTurn,
	installedSkills,
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
	AgentProfileSettings,
	AssistantScope,
	AssistantService,
	ChatEvent,
	ChatRequest,
} from "@nightshift/flows";
import { authoringPort, type ChatSpace } from "./authoring";
import {
	type ChatThread,
	createThreadStore,
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

export type PickedProfile = { name: string; settings: AgentProfileSettings };

export const NO_PROFILE =
	"No profile can make suggestions on this computer. Add a profile on the Agents page, with a harness that is installed here.";

export const NO_CHAT_PROFILE =
	"No profile can chat on this computer. Add a profile on the Agents page that uses Claude Code, Codex or OpenCode.";

export const NO_CLONE =
	"This project is not on this computer. Add its folder here, then ask again.";

export const BUSY =
	"The agent still answers your last message. Wait for it, or stop it first.";

/** Why a chat cannot run on this profile, or null. */
export function chatRefusal(picked: PickedProfile): string | null {
	return chatCanUseTools(picked.settings.harness)
		? null
		: `The chat cannot use the profile "${picked.name}": ${harnessLabel(picked.settings.harness)} cannot read your flow or propose changes. Choose a profile that uses Claude Code, Codex or OpenCode for the chat.`;
}

/**
 * The profile the assistant runs on: the one the request names, else the
 * one in the settings ("Profile for suggestions"), else the first profile
 * whose harness is added and installed here. With `fits`, the setting and
 * the first profile count only when their harness fits; the request's own
 * profile always counts, so the caller can say why it does not fit.
 * A message for the person when there is none.
 */
export function pickProfile(
	requested: string | undefined,
	deps: Pick<
		AssistantDeps,
		"profiles" | "settings" | "harnessFor" | "installed"
	>,
	fallback: {
		fits?: (harness: AgentHarnessName) => boolean;
		none?: string;
	} = {},
): PickedProfile | { error: string } {
	const all = deps.profiles.list();
	const named = (name: string) => {
		const found = all.find((profile) => profile.name === name);
		if (!found) return null;
		const { name: _n, description: _d, updatedAt: _u, ...settings } = found;
		return { name, settings };
	};
	if (requested) {
		return (
			named(requested) ?? {
				error: `There is no profile "${requested}" on this computer. Pick another one, or add it on the Agents page.`,
			}
		);
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
		? (named(ready.name) as PickedProfile)
		: { error: fallback.none ?? NO_PROFILE };
}

/** The harness of a profile, or a message for the person. */
function harnessOf(
	picked: PickedProfile,
	deps: Pick<AssistantDeps, "harnessFor">,
): AgentHarness | { error: string } {
	return (
		deps.harnessFor(picked.settings.harness) ?? {
			error: `The profile "${picked.name}" runs on the ${harnessNoun(picked.settings.harness)}, which is not added on this computer. Add it on the Agents page, or pick another profile.`,
		}
	);
}

/** The daemon's assistant: suggestions and chats on this computer's profiles, read only in the project's Clone. */
export function createAssistant(deps: AssistantDeps): AssistantService {
	const threads = deps.threads ?? createThreadStore();
	const skills = deps.skills ?? installedSkills;

	/** The thread a message continues, when it still can. */
	const continued = (request: ChatRequest): ChatThread | null => {
		const thread = request.threadId ? threads.get(request.threadId) : null;
		return thread &&
			thread.projectId === request.projectId &&
			thread.flowName === request.flowName &&
			(!request.profile || request.profile === thread.profile)
			? thread
			: null;
	};

	return {
		async *suggest(request, signal) {
			const picked = pickProfile(request.profile, deps);
			if ("error" in picked) {
				yield { type: "error", message: picked.error };
				return;
			}
			const harness = harnessOf(picked, deps);
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
			const picked = pickProfile(request.profile ?? existing?.profile, deps, {
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
			const harness = harnessOf(picked, deps);
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
				existing && existing.profile === picked.name
					? existing
					: threads.start({
							projectId: request.projectId,
							flowName: request.flowName,
							profile: picked.name,
						});
			const resume = thread.sessionId;
			const newRun =
				request.runId !== undefined && !thread.runIds.has(request.runId);
			thread.busy = true;
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
					...(resume ? { resumeSessionId: resume, newRun } : {}),
					signal,
				})) {
					if (event.type === "session") {
						thread.sessionId = event.sessionId;
						continue;
					}
					yield event;
				}
				if (request.runId) thread.runIds.add(request.runId);
			} finally {
				thread.busy = false;
			}
		},
	};
}
