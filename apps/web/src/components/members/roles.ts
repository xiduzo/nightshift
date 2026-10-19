import type { SpaceRole } from "@/lib/api-types";

/** What each role in a Space may do, in the words the Members page uses. */
const ROLES: Record<SpaceRole, { label: string; description: string }> = {
	owner: {
		label: "Owner",
		description: "Can do everything, also delete the Space.",
	},
	admin: {
		label: "Admin",
		description: "Can do everything but delete the Space.",
	},
	member: {
		label: "Member",
		description: "Can add projects, start runs and answer gates.",
	},
	viewer: {
		label: "Viewer",
		description: "Can see projects and runs, and change nothing.",
	},
};

/** The roles a person can invite with, most rights first. */
export const INVITE_ROLES = ["admin", "member", "viewer"] as const;

/** Every role, most rights first. */
export const ALL_ROLES = ["owner", ...INVITE_ROLES] as const;

export function roleLabel(
	role: SpaceRole,
	what: "label" | "description" = "label",
): string {
	return ROLES[role][what];
}
