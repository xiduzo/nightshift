import { createAccessControl } from "better-auth/plugins/access";
import {
	adminAc,
	defaultStatements,
	memberAc,
	ownerAc,
} from "better-auth/plugins/organization/access";

/**
 * Who may do what in a Space: Night Shift's statements beside the
 * organization plugin's own (which its endpoints check: invitations,
 * members, the organization itself). `member` holds both sets.
 */
export const statements = {
	...defaultStatements,
	project: ["add", "remove", "move"],
	run: ["start", "stop", "resume", "move", "export"],
	gate: ["resolve"],
	signal: ["send"],
	offer: ["use", "make"],
	flow: ["save", "remove"],
	schedule: ["save"],
	member: [...defaultStatements.member, "invite", "remove", "role"],
	space: ["settings", "delete"],
} as const;

export const ac = createAccessControl(statements);

/** A set of actions per statement, as `roleAllows` and the organization plugin take it. */
export type Permissions = {
	[S in keyof typeof statements]?: (typeof statements)[S][number][];
};

const everything = {
	project: ["add", "remove", "move"],
	run: ["start", "stop", "resume", "move", "export"],
	gate: ["resolve"],
	signal: ["send"],
	offer: ["use", "make"],
	flow: ["save", "remove"],
	schedule: ["save"],
} satisfies Permissions;

/**
 * The default roles. Owner: all. Admin: all but deleting the Space.
 * Member: adds projects, runs, answers Gates, sends signals, saves and
 * removes flows and schedules, uses Offers (but makes none: offering a
 * Device's profile to a Space is for its owners and admins). Viewer:
 * nothing that writes.
 */
export const roles = {
	owner: ac.newRole({
		...ownerAc.statements,
		...everything,
		member: [...ownerAc.statements.member, "invite", "remove", "role"],
		space: ["settings", "delete"],
	}),
	admin: ac.newRole({
		...adminAc.statements,
		...everything,
		member: [...adminAc.statements.member, "invite", "remove", "role"],
		space: ["settings"],
	}),
	member: ac.newRole({
		...memberAc.statements,
		...everything,
		project: ["add"],
		offer: ["use"],
	}),
	viewer: ac.newRole({}),
};

export type Role = keyof typeof roles;

/**
 * Whether a role allows `permissions`: the one check of who may do what in
 * a Space, for a request (`requestAccess`) and for checks without one (the
 * sync socket). Like the organization plugin, a member row may hold more
 * roles, comma separated: one that allows is enough. An unknown role
 * allows nothing.
 */
export function roleAllows(role: string, permissions: Permissions): boolean {
	return role.split(",").some((name) => {
		const known = roles[name.trim() as Role] as
			| (typeof roles)[Role]
			| undefined;
		return known?.authorize(permissions).success === true;
	});
}
