import {
	type Permissions,
	type RequestAccess,
	type Role,
	roleAllows,
	type Session,
} from "@nightshift/auth";
import type { SpaceEngine } from "@nightshift/engine";

import type { Context, Services } from "../context";

/**
 * The fields of a test's context. Each service may be given in part: the
 * test names only what its procedures use.
 */
export type TestContextFields = Partial<Omit<Context, keyof Services>> & {
	[K in keyof Services]?: Partial<Services[K]>;
};

/** Every service the Context has, for `testContext` to fill. */
const SERVICES: Record<keyof Services, true> = {
	devices: true,
	exchange: true,
	offers: true,
	db: true,
	engine: true,
	settings: true,
	notifications: true,
	connections: true,
	cliTools: true,
	toolLaunchers: true,
	profiles: true,
	assistant: true,
	checks: true,
	projectSetup: true,
	daemon: true,
};

/**
 * `given` as a whole `T`, for a fake that has only what a test uses: a
 * member it does not have throws when something reads it, with its name,
 * instead of failing later on `undefined`.
 */
export function stub<T extends object>(
	name: string,
	given: Partial<T> = {},
): T {
	return new Proxy(given, {
		get(target, key) {
			if (key in target || typeof key === "symbol" || key === "then") {
				return Reflect.get(target, key);
			}
			throw new Error(
				`This test's ${name} has no ${key}. Give it to the fake (testContext, stub).`,
			);
		},
	}) as T;
}

/** A request without a session: it may do nothing in any Space. */
function signedOut(): RequestAccess {
	const refuse = async (): Promise<never> => {
		throw new Error("This test's request is signed out.");
	};
	return {
		session: null,
		spaceId: null,
		headers: new Headers(),
		hostAccess: { allowed: true },
		can: async () => false,
		roleIn: async () => null,
		setActiveSpace: refuse,
		createSpace: refuse,
		members: {
			invite: refuse,
			cancelInvitation: refuse,
			setRole: refuse,
			remove: refuse,
			accept: refuse,
		},
	};
}

/**
 * The context of a procedure call in a test (`call(procedure, input,
 * { context })`). Without `access`, the request is signed out; give a real
 * one (`requestAccess` on an auth sandbox) or `accessAs`. A request from
 * another computer, on a Host that does not require two-factor sign-in,
 * unless the fields say otherwise. The Space view that every procedure in
 * a Space opens (`engine.space`) is a stub too, unless the test gives one.
 */
export function testContext(fields: TestContextFields = {}): Context {
	const given: TestContextFields = {
		...fields,
		engine: {
			space: () => stub<SpaceEngine>("Space view"),
			...fields.engine,
		},
	};
	const services = {} as Record<keyof Services, object>;
	for (const key of Object.keys(SERVICES) as (keyof Services)[]) {
		services[key] = stub<object>(key, given[key]);
	}
	return {
		...(services as Services),
		access: fields.access ?? signedOut(),
		fromThisComputer: fields.fromThisComputer ?? false,
		deviceKey: fields.deviceKey ?? null,
		requireTwoFactor: fields.requireTwoFactor ?? false,
		setLogin:
			fields.setLogin ??
			(async () => {
				throw new Error("This test's context has no setLogin.");
			}),
	};
}

/**
 * The access of a Person signed in on this computer, who works in
 * `spaceId` with `role`: no Better Auth behind it. Their role elsewhere is
 * none. Changes of Spaces and Members throw: a test of those uses a real
 * `requestAccess`.
 */
export function accessAs(person: {
	personId: string;
	spaceId: string;
	role: Role;
	name?: string;
}): RequestAccess {
	const { personId, spaceId, role, name = "Ada" } = person;
	// A session as Better Auth would read it, with the fields the
	// procedures use.
	const session = {
		user: {
			id: personId,
			name,
			email: `${name.toLowerCase()}@example.com`,
			twoFactorEnabled: false,
		},
		session: { id: `session-${personId}`, userId: personId },
	} as Session;
	return {
		...signedOut(),
		session,
		spaceId,
		can: async (permissions: Permissions, inSpace = spaceId) =>
			inSpace === spaceId && roleAllows(role, permissions),
		roleIn: async (space) => (space === spaceId ? role : null),
	};
}
