import { z } from "zod";
import { migrateToolSets } from "../document";
import { type Profile, profileSchema } from "./profiles";

/**
 * A project's profiles: `.nightshift/profiles.json` in the repo, with the
 * same profiles as a computer's (Agent Profiles and Model Profiles, each
 * with its name). A flow that names a profile finds it here, so it runs on
 * a computer that has no profile of that name; a computer's own profile of
 * the same name wins.
 *
 * ```json
 * { "version": 1, "profiles": [
 *   { "name": "builder", "harness": "claude-code", "model": "sonnet", "permissionMode": "acceptEdits" },
 *   { "name": "triage", "decider": "openrouter", "model": "~typesafe/jev-latest" }
 * ] }
 * ```
 */

export const PROFILES_VERSION = 1;

/** The file as a whole. Each profile is read on its own, so one bad entry leaves the rest. */
const profilesFileSchema = z.object({
	version: z.literal(PROFILES_VERSION),
	profiles: z.array(z.unknown()).default([]),
});

/**
 * What the profiles file of a project holds, as plain data that can cross
 * a wire: its parsed JSON, why it is not JSON, or null when there is none.
 */
export type ProfilesSource = { json: unknown } | { jsonError: string } | null;

/** One problem in the profiles file. A profile with an error is left out. */
export type ProfileIssue = {
	severity: "error" | "warning";
	message: string;
	/** Absent for problems of the whole file. */
	profile?: string;
};

/** The profiles of a project's file, and its problems. */
export type ProjectProfiles = {
	profiles: Profile[];
	issues: ProfileIssue[];
};

/**
 * Reads a project's profiles file. No file is no profiles. A file that is
 * not JSON, or not this shape, has no profiles and says why. A profile that
 * does not match the schema, or repeats an earlier name, is left out with
 * an error.
 */
export function parseProfilesSource(source: ProfilesSource): ProjectProfiles {
	if (source === null) return { profiles: [], issues: [] };
	if (!("json" in source)) {
		return {
			profiles: [],
			issues: [
				{ severity: "error", message: `Not valid JSON: ${source.jsonError}` },
			],
		};
	}
	const file = profilesFileSchema.safeParse(source.json);
	if (!file.success) {
		return {
			profiles: [],
			issues: file.error.issues.map((issue) => ({
				severity: "error",
				message: `${issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)"}: ${issue.message}`,
			})),
		};
	}
	const profiles: Profile[] = [];
	const issues: ProfileIssue[] = [];
	file.data.profiles.forEach((entry, index) => {
		const named =
			typeof entry === "object" &&
			entry !== null &&
			"name" in entry &&
			typeof entry.name === "string"
				? entry.name
				: undefined;
		const parsed = profileSchema.safeParse(migrateToolSets(entry));
		if (!parsed.success) {
			issues.push({
				severity: "error",
				message: `The profile ${named ? `"${named}"` : `at position ${index + 1}`} is not valid. It needs a name, and either a harness, a model and a permission mode (for Agent nodes) or a decider (for Decision and Value nodes).`,
				...(named ? { profile: named } : {}),
			});
			return;
		}
		if (profiles.some((p) => p.name === parsed.data.name)) {
			issues.push({
				severity: "error",
				message: `Two profiles are named "${parsed.data.name}". Give each its own name.`,
				profile: parsed.data.name,
			});
			return;
		}
		profiles.push(parsed.data);
	});
	return { profiles, issues };
}
