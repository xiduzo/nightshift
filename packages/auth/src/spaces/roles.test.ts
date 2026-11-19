import { describe, expect, test } from "bun:test";
import { createAccessControl } from "better-auth/plugins/access";
import {
	adminAc,
	defaultStatements,
	memberAc,
	ownerAc,
} from "better-auth/plugins/organization/access";
import { ac, roles } from "../auth";
import {
	type Permissions,
	ROLE_PERMISSIONS,
	roleAllows,
	statements,
} from "./roles";

/**
 * The pure role table and `roleAllows` answer as Better Auth's access
 * control (better-auth 1.7.25) does: the table holds the roles as they
 * were built from the organization plugin's own (`ownerAc`, `adminAc`,
 * `memberAc`), and `roleAllows` decides as `authorize` does over every
 * role and every request below.
 */

/** The roles as Night Shift built them on Better Auth before the table. */
const reference = (() => {
	const referenceAc = createAccessControl({
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
	} as const);
	const everything = {
		project: ["add", "remove", "move"],
		run: ["start", "stop", "resume", "move", "export"],
		gate: ["resolve"],
		signal: ["send"],
		offer: ["use", "make"],
		flow: ["save", "remove"],
		schedule: ["save"],
	} as const;
	return {
		statements: referenceAc.statements,
		roles: {
			owner: referenceAc.newRole({
				...ownerAc.statements,
				...everything,
				member: [...ownerAc.statements.member, "invite", "remove", "role"],
				space: ["settings", "delete"],
			}),
			admin: referenceAc.newRole({
				...adminAc.statements,
				...everything,
				member: [...adminAc.statements.member, "invite", "remove", "role"],
				space: ["settings"],
			}),
			member: referenceAc.newRole({
				...memberAc.statements,
				...everything,
				project: ["add"],
				offer: ["use"],
			}),
			viewer: referenceAc.newRole({}),
		} as Record<
			string,
			{ authorize(request: Permissions): { success: boolean } }
		>,
	};
})();

/** Better Auth's answer: a member row may hold more roles, comma separated. */
function referenceAllows(role: string, permissions: Permissions): boolean {
	return role.split(",").some((name) => {
		const known = Object.hasOwn(reference.roles, name.trim())
			? reference.roles[name.trim()]
			: undefined;
		return known?.authorize(permissions).success === true;
	});
}

const ROLES = [
	"owner",
	"admin",
	"member",
	"viewer",
	"owner,viewer",
	"viewer, member",
	"viewer,admin",
	"unknown",
	"viewer,unknown",
	"",
	" admin ",
	"Owner",
];

/** Every single action, every statement whole, and the edge cases. */
const REQUESTS: Permissions[] = [
	...Object.entries(statements).flatMap(([statement, actions]) => [
		...actions.map((action) => ({ [statement]: [action] }) as Permissions),
		{ [statement]: [...actions] } as Permissions,
		{ [statement]: [] } as Permissions,
	]),
	{},
	{ run: ["start"], space: ["delete"] },
	{ run: ["start"], offer: ["use"] },
	{ project: ["add"], member: ["invite"] },
	{ organization: ["update"], space: ["settings"] },
	{ ac: ["read"] },
	{ run: ["start", "start"] },
	{ nothing: ["at-all"] } as unknown as Permissions,
	{ run: ["start"], nothing: ["at-all"] } as unknown as Permissions,
];

describe("the role table", () => {
	test("holds the statements Better Auth's access control was built with", () => {
		expect(statements).toEqual(reference.statements as never);
		expect(ac.statements).toEqual(reference.statements as never);
	});

	test("holds each role as it was built from the organization plugin's own", () => {
		for (const name of ["owner", "admin", "member", "viewer"] as const) {
			const built = reference.roles[name] as unknown as {
				statements: unknown;
			};
			expect(ROLE_PERMISSIONS[name]).toEqual(built.statements as never);
			expect(roles[name].statements).toEqual(built.statements as never);
		}
	});
});

describe("roleAllows", () => {
	test("answers as Better Auth's authorize does, for every role and request", () => {
		let compared = 0;
		for (const role of ROLES) {
			for (const request of REQUESTS) {
				expect({ role, request, allows: roleAllows(role, request) }).toEqual({
					role,
					request,
					allows: referenceAllows(role, request),
				});
				compared++;
			}
		}
		expect(compared).toBeGreaterThan(500);
	});

	test("an empty action list, an empty request and an unknown role allow nothing", () => {
		expect(roleAllows("owner", { run: [] })).toBe(false);
		expect(roleAllows("owner", {})).toBe(false);
		expect(roleAllows("unknown", { run: ["start"] })).toBe(false);
		expect(roleAllows("viewer,owner", { space: ["delete"] })).toBe(true);
	});
});
