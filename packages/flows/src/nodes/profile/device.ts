import { z } from "zod";
import type { NodeCheck } from "../base";
import { nameSchema } from "../names";

/**
 * Where a step runs: a Device by its id, and a profile of a Device as a
 * node names it, with its backups and their checks.
 */

/**
 * A Device by its id, as a node or a schedule names it. The Device's name
 * is only a label: Night Shift looks it up by the id, so a rename changes
 * no flow, and two Devices of one name never take each other's steps.
 */
export const deviceIdSchema = z.string().trim().min(1).max(128);

/**
 * A Device name that a flow of format 7 or a schedule from before ids
 * named, and that Night Shift could not bring to one Device's id: no
 * Device of the Space has that name, or two do. It does not run: the flow
 * check, and the schedule check, ask to choose the device again.
 */
export const legacyDeviceNameSchema = z.strictObject({
	name: z.string().trim().min(1).max(64),
});

/** A Device as a node or a schedule names it: its id, or a name left from before ids. */
export const deviceRefSchema = z.union([
	deviceIdSchema,
	legacyDeviceNameSchema,
]);
export type DeviceRef = z.infer<typeof deviceRefSchema>;

/** The Device's id, or undefined for none or a name left from before ids. */
export function deviceIdOf(device: DeviceRef | undefined): string | undefined {
	return typeof device === "string" ? device : undefined;
}

/** The name left from before ids, or null for an id or none. */
export function legacyDeviceName(device: DeviceRef | undefined): string | null {
	return typeof device === "object" && device !== null ? device.name : null;
}

/**
 * Where the node's step runs, by the Device's id. Unset: the profile's
 * Device, else the Device of the Subflow it runs in (a Call node's
 * `device`), else the run's. On a Call node: where the steps of its flow
 * run.
 */
export const placed = { device: deviceRefSchema.optional() };

/**
 * A profile as a node names it (ADR 3): the Device it belongs to, by the
 * Device's id, and the profile's id on that Device. The profile's name is a
 * label, so a rename changes no flow. The profile's Device runs the step.
 */
export const profileRefSchema = z.object({
	/** The Device's id. */
	device: z.string().trim().min(1).max(128),
	/** The profile's id: a profile made before ids keeps its name as its id. */
	profile: z.string().trim().min(1).max(128),
});
export type ProfileRef = z.infer<typeof profileRefSchema>;

/**
 * The `profile` of a node: a `ProfileRef`, or the bare name of a profile
 * that a flow of format 6 named and that Night Shift could not find when
 * it brought the flow to format 7. A bare name does not run: the flow
 * check asks to pick the profile again.
 */
export const nodeProfileSchema = z.union([profileRefSchema, nameSchema]);
export type NodeProfile = z.infer<typeof nodeProfileSchema>;

/**
 * The profiles that take a node's step when its own profile's Device cannot
 * (ADR 19), first one first. Each is a pair, so a person reads exactly what
 * runs. Empty or unset: the step waits for its Device.
 */
export const profileFallbacksSchema = z.array(profileRefSchema).max(5);

/** Whether a node's profile names the pair, not a name left from format 6. */
export function isProfileRef(
	profile: NodeProfile | undefined,
): profile is ProfileRef {
	return typeof profile === "object" && profile !== null;
}

/** The same profile on the same Device. */
export function sameProfileRef(a: ProfileRef, b: ProfileRef): boolean {
	return a.device === b.device && a.profile === b.profile;
}

/**
 * The checks of a node's profile: a name left from format 6 must be
 * picked again, and a node that names a profile names no Device of its
 * own, because the profile's Device runs it. `title` starts each message:
 * "Agent".
 */
export function checkNodeProfile(
	node: {
		id: string;
		profile?: NodeProfile;
		device?: DeviceRef;
		fallbacks?: readonly ProfileRef[];
		cascade?: unknown;
	},
	title: string,
	check: NodeCheck,
): void {
	checkProfileFallbacks(node, title, check);
	if (node.profile === undefined) return;
	if (!isProfileRef(node.profile)) {
		check.error(
			`${title} node "${node.id}" names the profile "${node.profile}", but Night Shift cannot tell which computer's profile it is. Pick the profile again.`,
		);
		return;
	}
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
		profile?: NodeProfile;
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
	if (!isProfileRef(profile)) {
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

/** The plain text of `placed`: the Device's id, or a name left from before ids. */
export const placedPlain: readonly string[] = ["device", "device.name"];

/** The plain text of a node's profile and its backups (`profileRefSchema`). */
export const nodeProfilePlain: readonly string[] = [
	"profile.device",
	"profile.profile",
	"fallbacks[].device",
	"fallbacks[].profile",
];
