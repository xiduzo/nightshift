import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	spyOn,
	test,
} from "bun:test";
import {
	type HostPolicy,
	OPEN_HOST,
	personalSpaceId,
	requestAccess,
	TRUSTED_BROWSER_DAYS,
	TWO_FACTOR_REQUIRED,
} from "@nightshift/auth";
import {
	type AuthSandbox,
	createAuthSandbox,
	turnOnTwoFactor,
} from "@nightshift/auth/testing";
import {
	GateClosedError,
	HOST_UNREACHABLE,
	HostUnreachableError,
	type OpenGate,
	type SpaceEngine,
} from "@nightshift/engine";
import {
	FAILURE_MESSAGE,
	Refusal,
	type RefusalKind,
} from "@nightshift/refusal";
import { call, ORPCError } from "@orpc/server";

import type { Context } from "./context";
import { onOutputMismatch } from "./output";
import { readable } from "./procedures";
import { appRouter } from "./router";

/**
 * Sessions and roles on the procedures: a call needs a session, works in
 * the session's Space only, and does what the Person's role allows there.
 */

let sandbox: AuthSandbox;
/** Which Space each engine call went to, in order. */
let calls: { space: string; method: string }[];
/** What each engine call got, in order. */
let inputs: unknown[];
/** Every argument of each engine call, in order. */
let args: unknown[][];
/** The open Gates the fake engine lists, per Space. */
let gatesIn: Map<string, OpenGate[]>;
/** The Space of each run the fake engine keeps. */
let runSpaces: Map<string, string>;
/** What the fake engine's `resolveGate` does after it records the call. */
let onResolve: () => void;
beforeEach(async () => {
	sandbox = await createAuthSandbox();
	calls = [];
	inputs = [];
	args = [];
	gatesIn = new Map();
	runSpaces = new Map();
	onResolve = () => {};
});
afterEach(() => sandbox.cleanup());

// The fake engine answers `{ id: "run-1" }` to every call: these tests check
// sessions and roles, not replies. contract.test.ts checks the replies.
let quiet: () => void;
beforeAll(() => {
	quiet = onOutputMismatch(() => {});
});
afterAll(() => quiet());

/** An engine that records the Space and method of every call. */
const engine: Context["engine"] = {
	space: (space) =>
		new Proxy({} as SpaceEngine, {
			get:
				(_, method) =>
				(input: unknown, ...rest: unknown[]) => {
					calls.push({ space, method: String(method) });
					inputs.push(input);
					args.push([input, ...rest]);
					// A watch is a stream, not a promise: this one has no items.
					if (method === "watchRun") return (async function* () {})();
					return (async () => {
						if (method === "listGates") return gatesIn.get(space) ?? [];
						if (method === "resolveGate") return onResolve();
						return method === "listRuns" ? [] : { id: "run-1" };
					})();
				},
		}),
	spaceOfRun: async (runId) => runSpaces.get(runId) ?? null,
	logMemberChange: async () => {},
	onRunEvents: () => () => {},
	runHere: async () => null,
	deviceBack: async () => {},
	webhook: async () => ({
		answer: { kind: "not-found" },
		done: Promise.resolve(),
	}),
	dispose: async () => {},
};

/** A request from another computer, with these headers, on a Host with this policy. */
async function contextFor(
	headers: Headers | null,
	policy: HostPolicy = OPEN_HOST,
): Promise<Context> {
	const access = headers
		? await requestAccess(sandbox.auth, sandbox.db, headers, null, policy)
		: {
				session: null,
				spaceId: null,
				can: async () => false,
				roleIn: async () => null,
				setActiveSpace: async () => {},
				createSpace: async () => ({ id: "none" }),
				members: {} as Context["members"],
				hostAccess: { allowed: true } as const,
			};
	return {
		session: access.session,
		spaceId: access.spaceId,
		hostAccess: access.hostAccess,
		requireTwoFactor: policy.requireTwoFactor,
		fromThisComputer: false,
		can: access.can,
		roleIn: access.roleIn,
		setActiveSpace: access.setActiveSpace,
		createSpace: access.createSpace,
		members: access.members,
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

/** The refusal a call ends in: its code, whether the procedure declares it, and its message. */
async function refusalOf(
	promise: Promise<unknown>,
): Promise<{ code: string; defined: boolean; message: string }> {
	try {
		await promise;
	} catch (error) {
		if (error instanceof ORPCError) {
			return {
				code: error.code,
				defined: error.defined,
				message: error.message,
			};
		}
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
		runSpaces.set("r", spaceId);
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
		// The run is started by Bob: commits in it are in his name.
		expect(inputs.at(-1)).toEqual({ ...start, startedBy: bob.userId });
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

	test("a permitted call reads the session and the memberships once, and decides in memory", async () => {
		const { bob, spaceId } = await platform();
		const statements = sandbox.countStatements();
		const member = await contextFor(bob.headers);
		await call(appRouter.runs.start, start, { context: member });
		expect(calls.at(-1)).toEqual({ space: spaceId, method: "startRun" });
		// The session and its Person, then the memberships. It was 7.
		expect(statements()).toBe(3);
		// The inbox of every Space: the roles come with the Spaces, not 4
		// statements more per Space.
		await call(appRouter.gates.list, undefined, { context: member });
		expect(statements()).toBe(4);
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

	test("a member restarts a step and runs a run again from a step; a viewer may not", async () => {
		const { bob, cy, spaceId } = await platform();
		runSpaces.set("r", spaceId);
		const member = await contextFor(bob.headers);
		await call(
			appRouter.runs.restartStep,
			{ runId: "r", stepId: "s", prompt: "Report now." },
			{ context: member },
		);
		expect(calls.at(-1)).toEqual({ space: spaceId, method: "restartStep" });
		expect(args.at(-1)).toEqual(["r", { stepId: "s", prompt: "Report now." }]);
		await call(appRouter.runs.restartStep, { runId: "r" }, { context: member });
		expect(args.at(-1)).toEqual(["r", {}]);

		await call(
			appRouter.runs.rerun,
			{ runId: "r", nodeId: "worker", prompt: "Again.", fresh: true },
			{ context: member },
		);
		expect(calls.at(-1)).toEqual({ space: spaceId, method: "rerunFrom" });
		expect(args.at(-1)).toEqual([
			"r",
			{ nodeId: "worker", prompt: "Again.", fresh: true },
		]);

		const viewer = await contextFor(cy.headers);
		expect(
			await errorOf(
				call(appRouter.runs.restartStep, { runId: "r" }, { context: viewer }),
			),
		).toBe("FORBIDDEN");
		expect(
			await errorOf(
				call(
					appRouter.runs.rerun,
					{ runId: "r", nodeId: "worker" },
					{ context: viewer },
				),
			),
		).toBe("FORBIDDEN");
		expect(calls).toHaveLength(3);
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

describe("Members", () => {
	test("a personal Space takes no invitations", async () => {
		const ada = await sandbox.signUp("Ada");
		const context = await contextFor(ada.headers);
		const listed = await call(appRouter.members.list, undefined, { context });
		expect(listed.space).toMatchObject({ personal: true, role: "owner" });
		expect(listed.members.map((m) => m.name)).toEqual(["Ada"]);
		await expect(
			call(
				appRouter.members.invite,
				{ email: "carol@example.com", role: "member" },
				{ context },
			),
		).rejects.toThrow("Nobody can join a personal Space");
	});

	test("invite, open the link, sign up, accept: a Member who works in the Space", async () => {
		const { ada, spaceId } = await platform();
		const owner = await contextFor(ada.headers);
		const { id } = await call(
			appRouter.members.invite,
			{ email: "Carol@Example.com", role: "member" },
			{ context: owner },
		);
		const listed = await call(appRouter.members.list, undefined, {
			context: owner,
		});
		expect(listed.can).toEqual({
			invite: true,
			remove: true,
			changeRole: true,
		});
		expect(listed.invitations.map((i) => [i.email, i.role])).toEqual([
			["carol@example.com", "member"],
		]);

		// The link's page, before anyone signs in.
		const anonymous = await contextFor(null);
		expect(
			await call(
				appRouter.invitations.get,
				{ invitationId: id },
				{ context: anonymous },
			),
		).toMatchObject({
			spaceName: "Platform",
			email: "carol@example.com",
			status: "pending",
			hasAccount: false,
		});
		expect(
			await errorOf(
				call(
					appRouter.invitations.get,
					{ invitationId: "nope" },
					{ context: anonymous },
				),
			),
		).toBe("NOT_FOUND");

		const signedUp = await sandbox.auth.api.signUpEmail({
			body: {
				name: "Carol",
				email: "carol@example.com",
				password: "a-long-password",
				invitationId: id,
			} as { name: string; email: string; password: string },
			asResponse: true,
		});
		const carol = new Headers({
			cookie: signedUp.headers
				.getSetCookie()
				.map((c) => c.split(";")[0])
				.join("; "),
		});
		expect(
			await call(
				appRouter.invitations.accept,
				{ invitationId: id },
				{ context: await contextFor(carol) },
			),
		).toEqual({ spaceId });
		const joined = await contextFor(carol);
		expect(joined.spaceId).toBe(spaceId);
		const after = await call(appRouter.members.list, undefined, {
			context: joined,
		});
		expect(after.members.map((m) => [m.name, m.role])).toEqual([
			["Ada", "owner"],
			["Bob", "member"],
			["Cy", "viewer"],
			["Carol", "member"],
		]);
		expect(after.can).toEqual({
			invite: false,
			remove: false,
			changeRole: false,
		});
	});

	test("a viewer cannot invite, change roles or remove", async () => {
		const { cy } = await platform();
		const context = await contextFor(cy.headers);
		const listed = await call(appRouter.members.list, undefined, { context });
		const bob = listed.members.find((m) => m.name === "Bob");
		expect(
			await errorOf(
				call(
					appRouter.members.invite,
					{ email: "dee@example.com", role: "member" },
					{ context },
				),
			),
		).toBe("FORBIDDEN");
		expect(
			await errorOf(
				call(
					appRouter.members.setRole,
					{ memberId: bob?.id ?? "", role: "admin" },
					{ context },
				),
			),
		).toBe("FORBIDDEN");
		expect(
			await errorOf(
				call(
					appRouter.members.remove,
					{ memberId: bob?.id ?? "" },
					{ context },
				),
			),
		).toBe("FORBIDDEN");
	});

	test("an owner changes a role and removes a Member, who then loses the Space", async () => {
		const { ada, bob, spaceId } = await platform();
		const owner = await contextFor(ada.headers);
		const listed = await call(appRouter.members.list, undefined, {
			context: owner,
		});
		const membership = listed.members.find((m) => m.name === "Bob");
		await call(
			appRouter.members.setRole,
			{ memberId: membership?.id ?? "", role: "viewer" },
			{ context: owner },
		);
		const bobs = await contextFor(bob.headers);
		expect(
			await errorOf(call(appRouter.runs.start, start, { context: bobs })),
		).toBe("FORBIDDEN");

		await call(
			appRouter.members.remove,
			{ memberId: membership?.id ?? "" },
			{ context: owner },
		);
		const removed = await contextFor(bob.headers);
		expect(removed.spaceId).not.toBe(spaceId);
		await call(appRouter.runs.list, undefined, { context: removed });
		expect(calls.at(-1)?.space).toBe(removed.spaceId ?? "");
	});
});

/**
 * A Device key on the API's own procedures. The Host's peer protocol and
 * its key rules are `@nightshift/devices`' (`hostRouter`), tested there.
 */
describe("Device keys on the procedures", () => {
	test("a Device key is not a Person: no Space, no runs, no settings", async () => {
		const context: Context = {
			...(await contextFor(null)),
			deviceKey: {
				keyId: "k",
				deviceId: "device-b",
				personId: "ada",
				permissions: { sync: ["pull", "push"] },
			},
		};
		expect(
			await errorOf(call(appRouter.runs.list, undefined, { context })),
		).toBe("UNAUTHORIZED");
		expect(
			await errorOf(call(appRouter.devices.list, undefined, { context })),
		).toBe("UNAUTHORIZED");
		expect(calls).toEqual([]);
	});
});

describe("a Host that requires two-factor sign-in", () => {
	const REQUIRED = { requireTwoFactor: true };

	test("a session without it may only read how it signs in, until it turns two-factor on", async () => {
		const ada = await sandbox.signUp("Ada");
		const refused = await contextFor(ada.headers, REQUIRED);
		for (const procedure of [
			call(appRouter.runs.list, undefined, { context: refused }),
			call(appRouter.spaces.list, undefined, { context: refused }),
			call(
				appRouter.invitations.accept,
				{ invitationId: "x" },
				{
					context: refused,
				},
			),
			call(appRouter.settings.get, undefined, { context: refused }),
		]) {
			expect(await errorOf(procedure)).toBe(TWO_FACTOR_REQUIRED);
		}
		expect(calls).toEqual([]);
		expect(
			await call(appRouter.account.status, undefined, { context: refused }),
		).toEqual({
			signedIn: true,
			person: { name: "Ada", email: "ada@example.com" },
			thisComputer: false,
			hasPassword: true,
			// How long a trusted browser skips the code: the rule of auth, not a copy.
			twoFactor: {
				enabled: false,
				required: true,
				setUpNeeded: true,
				trustedBrowserDays: TRUSTED_BROWSER_DAYS,
			},
		});
		expect(
			await call(appRouter.healthCheck, undefined, { context: refused }),
		).toBe("OK");

		const { headers } = await turnOnTwoFactor(sandbox.auth, ada.headers);
		const allowed = await contextFor(headers, REQUIRED);
		expect(
			await call(appRouter.runs.list, undefined, { context: allowed }),
		).toEqual([]);
		expect(
			await call(appRouter.account.status, undefined, { context: allowed }),
		).toMatchObject({
			twoFactor: { enabled: true, required: true, setUpNeeded: false },
		});
	});

	test("a Device key is not affected", async () => {
		const context: Context = {
			...(await contextFor(null, REQUIRED)),
			devices: {
				hello: async () => ({ deviceId: "device-b" }),
			} as unknown as Context["devices"],
			deviceKey: {
				keyId: "k",
				deviceId: "device-b",
				personId: "ada",
				permissions: { sync: ["pull"] },
			},
		};
		expect(
			await call(appRouter.link.hello, undefined, { context }),
		).toMatchObject({ deviceId: "device-b" });
	});

	test("without a session, status says so", async () => {
		expect(
			await call(appRouter.account.status, undefined, {
				context: await contextFor(null, REQUIRED),
			}),
		).toMatchObject({ signedIn: false, twoFactor: { required: true } });
	});
});

describe("a streaming procedure", () => {
	/** The error `devices.join` ends in after its code, when the join throws `thrown`. */
	async function joinEndsIn(
		thrown: Error,
	): Promise<ORPCError<string, unknown>> {
		const ada = await sandbox.signUp("Ada");
		const base = await contextFor(ada.headers);
		const context = {
			...base,
			daemon: {
				...base.daemon,
				device: { ...base.daemon.device, ownerId: ada.userId },
			},
			devices: {
				async *join() {
					yield {
						kind: "code" as const,
						userCode: "ABCDEFGH",
						verificationUri: "https://studio.example.com/devices",
						verificationUriComplete:
							"https://studio.example.com/devices?pair=ABCDEFGH",
						fingerprint: null,
						expiresAt: 0,
					};
					throw thrown;
				},
			},
		} as unknown as Context;
		const progress = await call(
			appRouter.devices.join,
			{ url: "https://studio.example.com", role: "guest" },
			{ context, path: ["devices", "join"] },
		);
		const seen: string[] = [];
		try {
			for await (const step of progress) seen.push(step.kind);
		} catch (error) {
			expect(seen).toEqual(["code"]);
			expect(error).toBeInstanceOf(ORPCError);
			return error as ORPCError<string, unknown>;
		}
		throw new Error("The stream did not fail.");
	}

	test("passes a refusal on with its words, as it does for a plain call", async () => {
		const error = await joinEndsIn(
			new Refusal("forbidden", "The pairing was declined on the Host."),
		);
		expect(error.code).toBe("FORBIDDEN");
		expect(error.message).toBe("The pairing was declined on the Host.");
	});

	test("ends a failure in plain words, and logs it with the procedure", async () => {
		const failure = new Error("ECONNRESET: socket hang up at 10.0.0.7:443");
		const logged = spyOn(console, "error").mockImplementation(() => {});
		try {
			const error = await joinEndsIn(failure);
			expect(error.code).toBe("INTERNAL_SERVER_ERROR");
			expect(error.message).toBe(FAILURE_MESSAGE);
			expect(logged).toHaveBeenCalledWith(
				"[api] devices.join failed:",
				failure,
			);
		} finally {
			logged.mockRestore();
		}
	});
});

describe("the owner's own sign-in", () => {
	test("is set on this computer only", async () => {
		const ada = await sandbox.signUp("Ada");
		const set: string[] = [];
		const base = await contextFor(ada.headers);
		const context = (fromThisComputer: boolean) =>
			({
				...base,
				fromThisComputer,
				daemon: {
					...base.daemon,
					device: { ...base.daemon.device, ownerId: ada.userId },
				},
				setLogin: async (personId: string, input: { email: string }) => {
					set.push(personId);
					return { email: input.email };
				},
			}) as unknown as Context;
		const input = { email: "ada@example.com", password: "a-long-password" };
		expect(
			await errorOf(
				call(appRouter.account.setLogin, input, { context: context(false) }),
			),
		).toBe("FORBIDDEN");
		expect(set).toEqual([]);
		expect(
			await call(appRouter.account.setLogin, input, {
				context: context(true),
			}),
		).toEqual({ email: "ada@example.com" });
		expect(set).toEqual([ada.userId]);
	});
});

describe("a run opened by its id", () => {
	/** Platform's run, and Bob, Cy and Dee each in their personal Space. */
	async function aRunOfPlatform() {
		const people = await platform();
		const dee = await sandbox.signUp("Dee");
		for (const person of [people.bob, people.cy]) {
			const own = (await personalSpaceId(sandbox.db, person.userId)) ?? "";
			await sandbox.auth.api.setActiveOrganization({
				headers: person.headers,
				body: { organizationId: own },
			});
		}
		runSpaces.set("platform-run", people.spaceId);
		return { ...people, dee };
	}

	/** Reads the run, follows it to its end and stops it: one call each. */
	async function readFollowStop(context: Context, runId: string) {
		await call(appRouter.runs.get, { runId }, { context });
		const followed = await call(appRouter.runs.watch, { runId }, { context });
		for await (const _ of followed) {
			// The fake run has no items.
		}
		await call(appRouter.runs.stop, { runId, when: "now" }, { context });
	}

	test("reads, follows and stops a run of another of the Person's Spaces, without a switch", async () => {
		const { bob, spaceId } = await aRunOfPlatform();
		const context = await contextFor(bob.headers);
		const own = context.spaceId ?? "";
		expect(own).not.toBe(spaceId);

		await readFollowStop(context, "platform-run");
		// "Move to…" lists the Devices as the run's own Space sees them.
		await call(
			appRouter.runs.moveTargets,
			{ runId: "platform-run" },
			{ context },
		);
		expect(calls).toEqual([
			{ space: spaceId, method: "getRun" },
			{ space: spaceId, method: "watchRun" },
			{ space: spaceId, method: "stopRun" },
			{ space: spaceId, method: "listMoveTargets" },
		]);
		// The session still works in its own Space, and lists stay there.
		expect((await contextFor(bob.headers)).spaceId).toBe(own);
		await call(appRouter.runs.list, undefined, { context });
		expect(calls.at(-1)).toEqual({ space: own, method: "listRuns" });
	});

	test("finds the Person's role in the run's Space in the memberships the request read", async () => {
		const { bob } = await aRunOfPlatform();
		const context = await contextFor(bob.headers);
		const statements = sandbox.countStatements();
		await readFollowStop(context, "platform-run");
		// The fake engine reads nothing: no statement for the role either.
		expect(statements()).toBe(0);
	});

	test("is not found outside the Person's Spaces, the same as a run that does not exist", async () => {
		const { dee } = await aRunOfPlatform();
		const outsider = await contextFor(dee.headers);
		const notFound = {
			code: "NOT_FOUND",
			defined: true,
			message: "This run is not in one of your Spaces.",
		};
		for (const runId of ["platform-run", "no-such-run"]) {
			const { runs } = appRouter;
			expect(
				await refusalOf(call(runs.get, { runId }, { context: outsider })),
			).toEqual(notFound);
			expect(
				await refusalOf(call(runs.watch, { runId }, { context: outsider })),
			).toEqual(notFound);
			expect(
				await refusalOf(call(runs.stop, { runId }, { context: outsider })),
			).toEqual(notFound);
		}
		expect(calls).toEqual([]);
	});

	test("acts only as far as the Person's role in the run's Space allows", async () => {
		const { cy, spaceId } = await aRunOfPlatform();
		const viewer = await contextFor(cy.headers);
		await call(
			appRouter.runs.get,
			{ runId: "platform-run" },
			{ context: viewer },
		);
		expect(
			await refusalOf(
				call(
					appRouter.runs.stop,
					{ runId: "platform-run" },
					{ context: viewer },
				),
			),
		).toEqual({
			code: "FORBIDDEN",
			defined: true,
			message: "Your role in this Space does not allow this.",
		});
		expect(calls).toEqual([{ space: spaceId, method: "getRun" }]);
	});

	test("removes what a run of another Space left on this computer, for its owner only", async () => {
		const { bob, cy, spaceId } = await aRunOfPlatform();
		const asOwner = async (person: { headers: Headers; userId: string }) => {
			const base = await contextFor(person.headers);
			return {
				...base,
				daemon: {
					...base.daemon,
					device: { ...base.daemon.device, ownerId: person.userId },
				},
			} as Context;
		};
		const copy = { runId: "platform-run" };
		await call(appRouter.projects.removeRunCopy, copy, {
			context: await asOwner(bob),
		});
		expect(calls).toEqual([{ space: spaceId, method: "removeRunCopy" }]);
		// Cy is a Member of Platform, but this computer is not hers.
		expect(
			await errorOf(
				call(appRouter.projects.deleteRunBranches, copy, {
					context: await contextFor(cy.headers),
				}),
			),
		).toBe("FORBIDDEN");
		expect(calls).toHaveLength(1);
	});
});

/** An open Gate of a run in a Space, opened at `openedAt`. */
function openGate(spaceId: string, runId: string, openedAt: number): OpenGate {
	return {
		spaceId,
		runId,
		runTitle: `Run ${runId}`,
		flowName: null,
		projectId: `project-${runId}`,
		projectName: "Project",
		stepId: `step-${runId}`,
		nodeId: "ship",
		question: "Ship it?",
		choices: [{ name: "yes" }, { name: "no" }],
		openedAt,
		walker: { id: "device", name: "test", thisDevice: true },
		answerPending: false,
		lockScreen: false,
	};
}

describe("the Needs-you inbox", () => {
	test("lists the open Gates of every Space the Person is in, oldest first, with each Space's name", async () => {
		const { ada, cy, spaceId } = await platform();
		const personal = (await personalSpaceId(sandbox.db, ada.userId)) ?? "";
		const dee = await sandbox.signUp("Dee");
		const deesOwn = (await personalSpaceId(sandbox.db, dee.userId)) ?? "";
		gatesIn.set(spaceId, [openGate(spaceId, "platform-run", 20)]);
		gatesIn.set(personal, [openGate(personal, "ada-run", 10)]);
		gatesIn.set(deesOwn, [openGate(deesOwn, "dee-run", 5)]);

		// Ada works in Platform; her inbox has her personal Space's Gate too.
		const context = await contextFor(ada.headers);
		expect(context.spaceId).toBe(spaceId);
		const listed = await call(appRouter.gates.list, undefined, { context });
		expect(
			listed.map((g) => [g.runId, g.spaceId, g.spaceName, g.canAnswer]),
		).toEqual([
			["ada-run", personal, "Personal", true],
			["platform-run", spaceId, "Platform", true],
		]);

		// A viewer sees the Gate of Platform, and may not answer it.
		const viewer = await contextFor(cy.headers);
		const seen = await call(appRouter.gates.list, undefined, {
			context: viewer,
		});
		expect(seen.map((g) => [g.runId, g.canAnswer])).toEqual([
			["platform-run", false],
		]);
	});

	test("answers a Gate in another of the Person's Spaces without a switch", async () => {
		const { ada, spaceId } = await platform();
		const personal = (await personalSpaceId(sandbox.db, ada.userId)) ?? "";
		runSpaces.set("ada-run", personal);
		const context = await contextFor(ada.headers);
		expect(context.spaceId).toBe(spaceId);

		const answer = { runId: "ada-run", stepId: "step-1", choice: "yes" };
		await call(appRouter.gates.resolve, answer, { context });
		expect(calls).toEqual([{ space: personal, method: "resolveGate" }]);
		// Bound to its run and step.
		expect(inputs.at(-1)).toEqual(answer);
		// The session still works in Platform.
		expect((await contextFor(ada.headers)).spaceId).toBe(spaceId);
	});

	test("refuses an answer outside the Person's Spaces, or that their role does not allow", async () => {
		const { cy, spaceId } = await platform();
		const dee = await sandbox.signUp("Dee");
		runSpaces.set("platform-run", spaceId);
		const answer = { runId: "platform-run", stepId: "s", choice: "yes" };

		// Not a member: the same answer as a run that does not exist.
		const outsider = await contextFor(dee.headers);
		expect(
			await errorOf(
				call(appRouter.gates.resolve, answer, { context: outsider }),
			),
		).toBe("NOT_FOUND");
		expect(
			await errorOf(
				call(
					appRouter.gates.resolve,
					{ ...answer, runId: "no-such-run" },
					{ context: outsider },
				),
			),
		).toBe("NOT_FOUND");

		// A viewer of the Space.
		const viewer = await contextFor(cy.headers);
		expect(
			await errorOf(call(appRouter.gates.resolve, answer, { context: viewer })),
		).toBe("FORBIDDEN");
		expect(calls).toEqual([]);
	});

	test("takes an answer from the lock screen only for a Gate its author marked for it", async () => {
		const { bob, spaceId } = await platform();
		runSpaces.set("marked-run", spaceId);
		runSpaces.set("plain-run", spaceId);
		gatesIn.set(spaceId, [
			{ ...openGate(spaceId, "marked-run", 1), lockScreen: true },
			openGate(spaceId, "plain-run", 2),
		]);
		const context = await contextFor(bob.headers);
		const fromLockScreen = (runId: string) => ({
			runId,
			stepId: `step-${runId}`,
			choice: "yes",
			via: "lock-screen" as const,
		});

		await call(appRouter.gates.resolve, fromLockScreen("marked-run"), {
			context,
		});
		expect(inputs.at(-1)).toEqual({
			runId: "marked-run",
			stepId: "step-marked-run",
			choice: "yes",
		});

		expect(
			await refusalOf(
				call(appRouter.gates.resolve, fromLockScreen("plain-run"), {
					context,
				}),
			),
		).toEqual({
			code: "NEEDS_APP",
			defined: true,
			message: "Open this Gate in Night Shift to answer it.",
		});
		// A choice the Gate does not have needs the app too.
		expect(
			await errorOf(
				call(
					appRouter.gates.resolve,
					{ ...fromLockScreen("marked-run"), choice: "approve-deploy" },
					{ context },
				),
			),
		).toBe("NEEDS_APP");
		// A Gate that is no longer open is closed.
		runSpaces.set("closed-run", spaceId);
		expect(
			await refusalOf(
				call(appRouter.gates.resolve, fromLockScreen("closed-run"), {
					context,
				}),
			),
		).toEqual({
			code: "GATE_CLOSED",
			defined: true,
			message: "This Gate does not wait anymore.",
		});
		// So is one with an answer on its way.
		runSpaces.set("pending-run", spaceId);
		gatesIn.set(spaceId, [
			{
				...openGate(spaceId, "pending-run", 3),
				lockScreen: true,
				answerPending: true,
			},
			openGate(spaceId, "plain-run", 2),
		]);
		expect(
			await errorOf(
				call(appRouter.gates.resolve, fromLockScreen("pending-run"), {
					context,
				}),
			),
		).toBe("GATE_CLOSED");
		expect(
			calls.filter((c) => c.method === "resolveGate").map((c) => c.space),
		).toEqual([spaceId]);

		// From the app, the same Gate takes the answer.
		const { via: _via, ...inApp } = fromLockScreen("plain-run");
		await call(appRouter.gates.resolve, inApp, { context });
		expect(inputs.at(-1)).toEqual(inApp);
	});

	test("refuses an answer once the Gate is closed, without the step's id", async () => {
		const { bob, spaceId } = await platform();
		runSpaces.set("platform-run", spaceId);
		onResolve = () => {
			throw new GateClosedError("Step s is not the open Gate of this run.");
		};
		const context = await contextFor(bob.headers);
		expect(
			await refusalOf(
				call(
					appRouter.gates.resolve,
					{ runId: "platform-run", stepId: "s", choice: "yes" },
					{ context },
				),
			),
		).toEqual({
			code: "GATE_CLOSED",
			defined: true,
			message: "This Gate does not wait anymore.",
		});
	});

	test("another refusal is the status of its kind, with its words", async () => {
		const { bob, spaceId } = await platform();
		runSpaces.set("platform-run", spaceId);
		onResolve = () => {
			throw new Refusal("conflict", "The run cap is reached: 2 runs at once.");
		};
		const context = await contextFor(bob.headers);
		expect(
			await refusalOf(
				call(
					appRouter.gates.resolve,
					{ runId: "platform-run", stepId: "s", choice: "yes" },
					{ context },
				),
			),
		).toEqual({
			code: "CONFLICT",
			defined: false,
			message: "The run cap is reached: 2 runs at once.",
		});
	});

	test("a failure is a 500 in plain words, and its details go to the log", async () => {
		const { bob, spaceId } = await platform();
		runSpaces.set("platform-run", spaceId);
		const failure = new Error(
			"git worktree add failed: fatal: '/Users/bob/work' is already checked out (exit code 128)",
		);
		onResolve = () => {
			throw failure;
		};
		const context = await contextFor(bob.headers);
		const logged = spyOn(console, "error").mockImplementation(() => {});
		try {
			const error = await call(
				appRouter.gates.resolve,
				{ runId: "platform-run", stepId: "s", choice: "yes" },
				{ context, path: ["gates", "resolve"] },
			).then(
				() => new Error("The call did not fail."),
				(e: unknown) => e as Error,
			);
			expect(error).toBeInstanceOf(ORPCError);
			expect(error).toMatchObject({
				code: "INTERNAL_SERVER_ERROR",
				status: 500,
				defined: false,
				message: FAILURE_MESSAGE,
			});
			expect(error.message).not.toContain("fatal");
			expect(logged).toHaveBeenCalledWith(
				"[api] gates.resolve failed:",
				failure,
			);
		} finally {
			logged.mockRestore();
		}
	});

	test("a bug in the code is a failure too", async () => {
		const { bob, spaceId } = await platform();
		runSpaces.set("platform-run", spaceId);
		onResolve = () => {
			(null as unknown as { gate: string }).gate;
		};
		const context = await contextFor(bob.headers);
		const logged = spyOn(console, "error").mockImplementation(() => {});
		try {
			expect(
				await refusalOf(
					call(
						appRouter.gates.resolve,
						{ runId: "platform-run", stepId: "s", choice: "yes" },
						{ context },
					),
				),
			).toEqual({
				code: "INTERNAL_SERVER_ERROR",
				defined: false,
				message: FAILURE_MESSAGE,
			});
			expect(logged.mock.calls[0]?.[1]).toBeInstanceOf(TypeError);
		} finally {
			logged.mockRestore();
		}
	});

	test("an answer the Host of the Space cannot take now has its own code", async () => {
		const { bob, spaceId } = await platform();
		runSpaces.set("platform-run", spaceId);
		onResolve = () => {
			throw new HostUnreachableError();
		};
		const context = await contextFor(bob.headers);
		expect(
			await refusalOf(
				call(
					appRouter.gates.resolve,
					{ runId: "platform-run", stepId: "s", choice: "yes" },
					{ context },
				),
			),
		).toEqual({
			code: "HOST_UNREACHABLE",
			defined: false,
			message: HOST_UNREACHABLE,
		});
	});

	test("each refusal of an answer is declared", async () => {
		const { cy, spaceId } = await platform();
		const dee = await sandbox.signUp("Dee");
		runSpaces.set("platform-run", spaceId);
		const answer = { runId: "platform-run", stepId: "s", choice: "yes" };
		for (const [headers, code] of [
			[dee.headers, "NOT_FOUND"],
			[cy.headers, "FORBIDDEN"],
		] as const) {
			const refusal = await refusalOf(
				call(appRouter.gates.resolve, answer, {
					context: await contextFor(headers),
				}),
			);
			expect([refusal.code, refusal.defined]).toEqual([code, true]);
		}
	});
});

describe("the error rule at the API seam", () => {
	test("gives each kind of refusal its status, with its words", () => {
		const expected: Record<RefusalKind, { code: string; status: number }> = {
			invalid: { code: "BAD_REQUEST", status: 400 },
			"signed-out": { code: "UNAUTHORIZED", status: 401 },
			forbidden: { code: "FORBIDDEN", status: 403 },
			"not-found": { code: "NOT_FOUND", status: 404 },
			conflict: { code: "CONFLICT", status: 409 },
			unavailable: { code: "SERVICE_UNAVAILABLE", status: 503 },
		};
		for (const [kind, answer] of Object.entries(expected)) {
			const refusal = new Refusal(kind as RefusalKind, "Words for people.");
			expect(readable(refusal, ["runs", "start"])).toMatchObject({
				...answer,
				message: "Words for people.",
			});
		}
	});

	test("passes an oRPC error on as it is, a declared one too", () => {
		const declared = new ORPCError("GATE_CLOSED", {
			status: 409,
			message: "This Gate does not wait anymore.",
		});
		expect(readable(declared, ["gates", "resolve"])).toBe(declared);
	});
});
