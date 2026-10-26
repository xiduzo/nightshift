import { type AgentHarness, suggestField } from "@nightshift/agents";
import { harnessNoun } from "@nightshift/agents/harness-facts";
import type { ProfileStore, SettingsStore } from "@nightshift/engine";
import type {
	AgentHarnessName,
	AgentProfileSettings,
	AssistantService,
} from "@nightshift/flows";

/** Where the assistant finds a profile, its harness and the project on this computer. */
export type AssistantDeps = {
	profiles: Pick<ProfileStore, "list">;
	settings: Pick<SettingsStore, "current">;
	/** The harness of that name, when it is added on this computer. */
	harnessFor: (name: AgentHarnessName) => AgentHarness | undefined;
	/** Whether the harness's program is on this computer. */
	installed: (name: AgentHarnessName) => boolean;
	/** The folder of the project's Clone on this computer, or null. */
	clonePath: (projectId: string) => Promise<string | null>;
};

export type PickedProfile = { name: string; settings: AgentProfileSettings };

export const NO_PROFILE =
	"No profile can make suggestions on this computer. Add a profile on the Agents page, with a harness that is installed here.";

export const NO_CLONE =
	"This project is not on this computer. Add its folder here, then ask again.";

/**
 * The profile the assistant runs on: the one the request names, else the
 * one in the settings ("Profile for suggestions"), else the first profile
 * whose harness is added and installed here. A message for the person when
 * there is none.
 */
export function pickProfile(
	requested: string | undefined,
	deps: Pick<
		AssistantDeps,
		"profiles" | "settings" | "harnessFor" | "installed"
	>,
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
	// A profile in the settings that is gone falls back to the first that works.
	const fromSettings = chosen ? named(chosen) : null;
	if (fromSettings) return fromSettings;
	const ready = all.find(
		(profile) =>
			deps.harnessFor(profile.harness) !== undefined &&
			deps.installed(profile.harness),
	);
	return ready ? (named(ready.name) as PickedProfile) : { error: NO_PROFILE };
}

/** The daemon's assistant: suggestions on this computer's profiles, read only in the project's Clone. */
export function createAssistant(deps: AssistantDeps): AssistantService {
	return {
		async *suggest(request, signal) {
			const picked = pickProfile(request.profile, deps);
			if ("error" in picked) {
				yield { type: "error", message: picked.error };
				return;
			}
			const harness = deps.harnessFor(picked.settings.harness);
			if (!harness) {
				yield {
					type: "error",
					message: `The profile "${picked.name}" runs on the ${harnessNoun(picked.settings.harness)}, which is not added on this computer. Add it on the Agents page, or pick another profile.`,
				};
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
		// The chat comes with the assistant's panel.
		async *chat() {
			yield {
				type: "error",
				message: "The chat is not available yet.",
			} as const;
		},
	};
}
