import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { requestAccess } from "@nightshift/auth/request";
import { personalSpaceId } from "@nightshift/auth/spaces";
import {
	type AuthSandbox,
	createAuthSandbox,
} from "@nightshift/auth/test-support";
import type { SpaceEngine } from "@nightshift/engine/types";
import { call, ORPCError } from "@orpc/server";

import type { Context } from "./context";
import { appRouter } from "./routers/index";

/**
 * Sessions and roles on the procedures: a call needs a session, works in
 * the session's Space only, and does what the Person's role allows there.
 */

let sandbox: AuthSandbox;
/** Which Space each engine call went to, in order. */
let calls: { space: string; method: string }[];
beforeEach(async () => {
	sandbox = await createAuthSandbox();
	calls = [];
});
afterEach(() => sandbox.cleanup());

/** An engine that records the Space and method of every call. */
const engine: Context["engine"] = {
	space: (space) =>
		new Proxy({} as SpaceEngine, {
			get: (_, method) => async () => {
				calls.push({ space, method: String(method) });
				return method === "listRuns" ? [] : { id: "run-1" };
			},
		}),
	devices: {} as Context["engine"]["devices"],
	exchange: {} as Context["engine"]["exchange"],
};

async function contextFor(headers: Headers | null): Promise<Context> {
	const access = headers
		? await requestAccess(sandbox.auth, sandbox.db, headers, null)
		: {
				session: null,
				spaceId: null,
				can: async () => false,
				setActiveSpace: async () => {},
				createSpace: async () => ({ id: "none" }),
			};
	return {
		session: access.session,
		spaceId: access.spaceId,
		can: access.can,
		setActiveSpace: access.setActiveSpace,
		createSpace: access.createSpace,
		db: sandbox.db,
		engine,
		daemon: {
			dataDir: "/tmp",
			device: { id: "device", name: "test", ownerId: "the-owner" },
			lease: { host: "test", pid: 1, epoch: 1, since: 0 },
		},
	} as Context;
}

async function errorOf(promise: Promise<unknown>): Promise<string> {
	try {
		await promise;
	} catch (error) {
		if (error instanceof ORPCError) return error.code;
		throw error;
	}
	throw new Error("The call did not fail.");
}

/** A Space of Ada's with Bob as member and Cy as viewer; each session is in it. */
async function platform() {
	const ada = await sandbox.signUp("Ada");
	const bob = await sandbox.signUp("Bob");
	const cy = await sandbox.signUp("Cy");
	const space = await sandbox.auth.api.createOrganization({
		headers: ada.headers,
		body: { name: "Platform", slug: "platform" },
	});
	if (!space) throw new Error("no space");
	for (const [person, role] of [
		[bob, "member"],
		[cy, "viewer"],
	] as const) {
		await sandbox.auth.api.addMember({
			body: { userId: person.userId, role, organizationId: space.id },
		});
		await sandbox.auth.api.setActiveOrganization({
			headers: person.headers,
			body: { organizationId: space.id },
		});
	}
	return { ada, bob, cy, spaceId: space.id };
}

const start = { projectId: "p1", flowName: "night" };

describe("procedures", () => {
	test("a call without a session is refused", async () => {
		const context = await contextFor(null);
		expect(
			await errorOf(call(appRouter.runs.list, undefined, { context })),
		).toBe("UNAUTHORIZED");
		expect(await errorOf(call(appRouter.runs.start, start, { context }))).toBe(
			"UNAUTHORIZED",
		);
		expect(await call(appRouter.healthCheck, undefined, { context })).toBe(
			"OK",
		);
		expect(calls).toEqual([]);
	});

	test("a viewer cannot start a run; a member can, in their Space", async () => {
		const { bob, cy, spaceId } = await platform();

		const viewer = await contextFor(cy.headers);
		expect(viewer.spaceId).toBe(spaceId);
		expect(
			await errorOf(call(appRouter.runs.start, start, { context: viewer })),
		).toBe("FORBIDDEN");
		expect(
			await errorOf(
				call(
					appRouter.gates.resolve,
					{ runId: "r", stepId: "s", choice: "yes" },
					{ context: viewer },
				),
			),
		).toBe("FORBIDDEN");
		// Reading is fine.
		await call(appRouter.runs.list, undefined, { context: viewer });
		expect(calls).toEqual([{ space: spaceId, method: "listRuns" }]);

		const member = await contextFor(bob.headers);
		await call(appRouter.runs.start, start, { context: member });
		expect(calls.at(-1)).toEqual({ space: spaceId, method: "startRun" });
		// A member may not remove projects.
		expect(
			await errorOf(
				call(
					appRouter.projects.remove,
					{ projectId: "p1" },
					{ context: member },
				),
			),
		).toBe("FORBIDDEN");
	});

	test("a session works in its own Space only, never one it is not a member of", async () => {
		const { spaceId } = await platform();
		const dee = await sandbox.signUp("Dee");
		const own = (await personalSpaceId(sandbox.db, dee.userId)) ?? "";
		// A session that names a Space of others.
		await sandbox.db.$client.execute({
			sql: "UPDATE session SET active_organization_id = ? WHERE user_id = ?",
			args: [spaceId, dee.userId],
		});

		const context = await contextFor(dee.headers);
		expect(context.spaceId).toBe(own);
		await call(appRouter.runs.list, undefined, { context });
		await call(appRouter.gates.list, undefined, { context });
		expect(calls.map((c) => c.space)).toEqual([own, own]);
	});

	test("a Person lists their Spaces, personal first, and switches between them", async () => {
		const { ada, spaceId } = await platform();
		const dee = await sandbox.signUp("Dee");
		let context = await contextFor(ada.headers);
		const listed = await call(appRouter.spaces.list, undefined, { context });
		expect(listed.spaces.map((s) => [s.name, s.personal, s.role])).toEqual([
			["Personal", true, "owner"],
			["Platform", false, "owner"],
		]);
		expect(listed.active).toBe(spaceId);

		const personal = listed.spaces[0]?.id ?? "";
		await call(appRouter.spaces.switch, { spaceId: personal }, { context });
		context = await contextFor(ada.headers);
		expect(context.spaceId).toBe(personal);

		// Not a Space of Dee's.
		const theirs = await contextFor(dee.headers);
		await expect(
			call(appRouter.spaces.switch, { spaceId }, { context: theirs }),
		).rejects.toThrow();
		expect((await contextFor(dee.headers)).spaceId).not.toBe(spaceId);
	});

	test("this computer's configuration is its owner's", async () => {
		const ada = await sandbox.signUp("Ada");
		const context = await contextFor(ada.headers);
		expect(
			await errorOf(call(appRouter.settings.get, undefined, { context })),
		).toBe("FORBIDDEN");
		expect(
			await errorOf(call(appRouter.connections.list, undefined, { context })),
		).toBe("FORBIDDEN");
	});

	test("a Person creates a Space, owns it, and works in it", async () => {
		const ada = await sandbox.signUp("Ada");
		let context = await contextFor(ada.headers);
		const { id } = await call(
			appRouter.spaces.create,
			{ name: "  Platform  " },
			{ context },
		);
		context = await contextFor(ada.headers);
		expect(context.spaceId).toBe(id);
		const listed = await call(appRouter.spaces.list, undefined, { context });
		expect(listed.spaces.find((s) => s.id === id)).toEqual({
			id,
			name: "Platform",
			personal: false,
			role: "owner",
		});
	});

	test("moving a project needs project.move in both Spaces", async () => {
		const { ada, bob, spaceId } = await platform();
		const move = { projectId: "p1", spaceId };

		// Ada owns her personal Space and Platform: she may.
		const personal = (await personalSpaceId(sandbox.db, ada.userId)) ?? "";
		const owner = await contextFor(ada.headers);
		await call(
			appRouter.spaces.switch,
			{ spaceId: personal },
			{ context: owner },
		);
		await call(appRouter.projects.move, move, {
			context: await contextFor(ada.headers),
		});
		expect(calls.at(-1)).toEqual({ space: personal, method: "moveProject" });

		// Bob is only a member of Platform: moving into it from his own Space is refused.
		const bobsOwn = (await personalSpaceId(sandbox.db, bob.userId)) ?? "";
		const member = await contextFor(bob.headers);
		await call(
			appRouter.spaces.switch,
			{ spaceId: bobsOwn },
			{ context: member },
		);
		expect(
			await errorOf(
				call(appRouter.projects.move, move, {
					context: await contextFor(bob.headers),
				}),
			),
		).toBe("FORBIDDEN");
		// And out of Platform too: a member may not move.
		await call(appRouter.spaces.switch, { spaceId }, { context: member });
		expect(
			await errorOf(
				call(
					appRouter.projects.move,
					{ projectId: "p1", spaceId: bobsOwn },
					{ context: await contextFor(bob.headers) },
				),
			),
		).toBe("FORBIDDEN");
		expect(calls.filter((c) => c.method === "moveProject")).toHaveLength(1);
	});

	test("a member renames a project; a viewer may not", async () => {
		const { bob, cy, spaceId } = await platform();
		const rename = { projectId: "p1", name: "App" };
		await call(appRouter.projects.rename, rename, {
			context: await contextFor(bob.headers),
		});
		expect(calls.at(-1)).toEqual({ space: spaceId, method: "renameProject" });
		expect(
			await errorOf(
				call(appRouter.projects.rename, rename, {
					context: await contextFor(cy.headers),
				}),
			),
		).toBe("FORBIDDEN");
	});
});

describe("Device keys on the procedures", () => {
	/** A Host whose `hello` answers with the key it was given. */
	const devices = {
		hello: async (key: { deviceId: string; personId: string }) => ({
			host: { id: "host", name: "studio", addresses: [] },
			deviceId: key.deviceId,
			personId: key.personId,
		}),
	} as unknown as Context["devices"];

	async function deviceContext(
		permissions: Record<string, string[]> | null,
	): Promise<Context> {
		const context = await contextFor(null);
		return {
			...context,
			devices,
			deviceKey: permissions
				? { keyId: "k", deviceId: "device-b", personId: "ada", permissions }
				: null,
		};
	}

	test("a Device's link needs a key that allows sync", async () => {
		expect(
			await errorOf(
				call(appRouter.link.hello, undefined, {
					context: await deviceContext(null),
				}),
			),
		).toBe("UNAUTHORIZED");
		expect(
			await errorOf(
				call(appRouter.link.heartbeat, undefined, {
					context: await deviceContext({ archive: ["put", "get"] }),
				}),
			),
		).toBe("FORBIDDEN");
		expect(
			await call(appRouter.link.hello, undefined, {
				context: await deviceContext({ sync: ["pull", "push"] }),
			}),
		).toMatchObject({ deviceId: "device-b", personId: "ada" });
	});

	test("a Device key is not a Person: no Space, no runs, no settings", async () => {
		const context = await deviceContext({ sync: ["pull", "push"] });
		expect(
			await errorOf(call(appRouter.runs.list, undefined, { context })),
		).toBe("UNAUTHORIZED");
		expect(
			await errorOf(call(appRouter.devices.list, undefined, { context })),
		).toBe("UNAUTHORIZED");
		expect(calls).toEqual([]);
	});
});
