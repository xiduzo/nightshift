import { z } from "zod";
import type { NodeCheck } from "../base";

/**
 * Where a step runs: a Device by its id, and a profile of a Device as a
 * node names it, with its backups and their checks.
 */

/**
 * A Device by its id, as a node names it. The Device's name
 * is only a label: Night Shift looks it up by the id, so a rename changes
 * no flow, and two Devices of one name never take each other's steps.
 */
export const deviceIdSchema = z
	.string({
		error: "A device is named by its id. Choose the device again.",
	})
	.trim()
	.min(1)
	.max(128);

/**
 * Where the node's step runs, by the Device's id. Unset: the profile's
 * Device, else the Device of the Subflow it runs in (a Call node's
 * `device`), else the run's. On a Call node: where the steps of its flow
 * run.
 */
export const placed = { device: deviceIdSchema.optional() };

/**
 * A profile as a node names it (ADR 3): the Device it belongs to, by the
 * Device's id, and the profile's id on that Device. The profile's name is a
 * label, so a rename changes no flow. The profile's Device runs the step.
 */
export const profileRefSchema = z.object(
	{
		/** The Device's id. */
		device: z.string().trim().min(1).max(128),
		/** The profile's id. */
		profile: z.string().trim().min(1).max(128),
	},
	{
		error:
			"A profile is named by its device and its id. Pick the profile again.",
	},
);
export type ProfileRef = z.infer<typeof profileRefSchema>;

/**
 * The profiles that take a node's step when its own profile's Device cannot
 * (ADR 19), first one first. Each is a pair, so a person reads exactly what
 * runs. Empty or unset: the step waits for its Device.
 */
export const profileFallbacksSchema = z.array(profileRefSchema).max(5);

/** The same profile on the same Device. */
export function sameProfileRef(a: ProfileRef, b: ProfileRef): boolean {
	return a.device === b.device && a.profile === b.profile;
}

/**
 * The checks of a node's profile: a node that names a profile names no
 * Device of its own, because the profile's Device runs it. `title` starts
 * each message: "Agent".
 */
export function checkNodeProfile(
	node: {
		id: string;
		profile?: ProfileRef;
		device?: string;
		fallbacks?: readonly ProfileRef[];
		cascade?: unknown;
	},
	title: string,
	check: NodeCheck,
): void {
	checkProfileFallbacks(node, title, check);
	if (node.profile === undefined) return;
	if (node.device !== undefined) {
		check.error(
			`${title} node "${node.id}" names a device and a profile. The step runs on the profile's device. Remove the device, or the profile.`,
		);
	}
}

/** A backup needs a profile to back up, and each is another profile. */
function checkProfileFallbacks(
	node: {
		id: string;
		profile?: ProfileRef;
		fallbacks?: readonly ProfileRef[];
		cascade?: unknown;
	},
	title: string,
	check: NodeCheck,
): void {
	const fallbacks = node.fallbacks ?? [];
	if (fallbacks.length === 0) return;
	if (node.cascade !== undefined) {
		check.error(
			`${title} node "${node.id}" has a cascade and backup profiles. The next tier is the backup. Remove the backup profiles.`,
		);
		return;
	}
	const { profile } = node;
	if (profile === undefined) {
		check.error(
			`${title} node "${node.id}" has backup profiles, but no profile of its own. Pick a profile first.`,
		);
		return;
	}
	const seen: ProfileRef[] = [profile];
	for (const fallback of fallbacks) {
		if (seen.some((other) => sameProfileRef(other, fallback))) {
			check.error(
				`${title} node "${node.id}" names the same profile more than once. Remove the backup that repeats it.`,
			);
			return;
		}
		seen.push(fallback);
	}
}

/** The plain text of `placed`: the Device's id. */
export const placedPlain: readonly string[] = ["device"];

/** The plain text of a node's profile and its backups (`profileRefSchema`). */
export const nodeProfilePlain: readonly string[] = [
	"profile.device",
	"profile.profile",
	"fallbacks[].device",
	"fallbacks[].profile",
];
