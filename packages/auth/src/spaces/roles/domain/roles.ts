/**
 * Who may do what in a Space: Night Shift's statements beside the
 * organization plugin's own (which its endpoints check: invitations,
 * members, the organization itself). `member` holds both sets. Pure data:
 * the composition (`auth.ts`) gives it to Better Auth's access control,
 * and `roles.test.ts` proves that both answer the same.
 */
export const statements = {
	// The organization plugin's own statements (`defaultStatements` of
	// better-auth 1.7.25), with Night Shift's member actions.
	organization: ["update", "delete"],
	member: ["create", "update", "delete", "invite", "remove", "role"],
	invitation: ["create", "cancel"],
	team: ["create", "update", "delete"],
	ac: ["create", "read", "update", "delete"],
	project: ["add", "remove", "move"],
	run: ["start", "stop", "resume", "move", "export"],
	gate: ["resolve"],
	signal: ["send"],
	offer: ["use", "make"],
	flow: ["save", "remove"],
	schedule: ["save"],
	space: ["settings", "delete"],
} as const;

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
 * nothing that writes. The organization plugin's part of each is its
 * `ownerAc`, `adminAc` and `memberAc` of better-auth 1.7.25.
 */
export const ROLE_PERMISSIONS = {
	owner: {
		organization: ["update", "delete"],
		member: ["create", "update", "delete", "invite", "remove", "role"],
		invitation: ["create", "cancel"],
		team: ["create", "update", "delete"],
		ac: ["create", "read", "update", "delete"],
		...everything,
		space: ["settings", "delete"],
	},
	admin: {
		organization: ["update"],
		invitation: ["create", "cancel"],
		member: ["create", "update", "delete", "invite", "remove", "role"],
		team: ["create", "update", "delete"],
		ac: ["create", "read", "update", "delete"],
		...everything,
		space: ["settings"],
	},
	member: {
		organization: [],
		member: [],
		invitation: [],
		team: [],
		ac: ["read"],
		...everything,
		project: ["add"],
		offer: ["use"],
	},
	viewer: {},
} satisfies Record<string, Permissions>;

export type Role = keyof typeof ROLE_PERMISSIONS;

/**
 * Whether a role allows `permissions`: the one check of who may do what in
 * a Space, for a request (`requestAccess`) and for checks without one (the
 * sync socket). Like the organization plugin, a member row may hold more
 * roles, comma separated: one that allows is enough. An unknown role
 * allows nothing.
 */
export function roleAllows(role: string, permissions: Permissions): boolean {
	return role.split(",").some((name) => {
		const known = name.trim();
		return (
			Object.hasOwn(ROLE_PERMISSIONS, known) &&
			grants(ROLE_PERMISSIONS[known as Role], permissions)
		);
	});
}

/**
 * Whether `granted` holds every action of `asked`, as Better Auth's role
 * check (`authorize` with "AND") decides: every statement asked is known
 * to the role and holds each action asked of it, an empty action list
 * allows nothing, and asking for nothing allows nothing.
 */
function grants(granted: Permissions, asked: Permissions): boolean {
	const entries = Object.entries(asked);
	if (entries.length === 0) return false;
	return entries.every(([statement, actions]) => {
		if (!Array.isArray(actions)) {
			throw new Error("Invalid access control request");
		}
		if (!Object.hasOwn(granted, statement)) return false;
		const allowed: readonly string[] =
			granted[statement as keyof Permissions] ?? [];
		return (
			actions.length > 0 &&
			actions.every(
				(action) => typeof action === "string" && allowed.includes(action),
			)
		);
	});
}
