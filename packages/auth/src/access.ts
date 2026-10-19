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
	offer: ["use"],
	member: [...defaultStatements.member, "invite", "remove", "role"],
	space: ["settings", "delete"],
} as const;

export const ac = createAccessControl(statements);

/** A set of actions per statement, as `hasPermission` takes it. */
export type Permissions = {
	[S in keyof typeof statements]?: (typeof statements)[S][number][];
};

const everything = {
	project: ["add", "remove", "move"],
	run: ["start", "stop", "resume", "move", "export"],
	gate: ["resolve"],
	signal: ["send"],
	offer: ["use"],
} satisfies Permissions;

/**
 * The default roles. Owner: all. Admin: all but deleting the Space.
 * Member: adds projects, runs, answers Gates, sends signals, uses Offers.
 * Viewer: nothing that writes.
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
	}),
	viewer: ac.newRole({}),
};

export type Role = keyof typeof roles;
