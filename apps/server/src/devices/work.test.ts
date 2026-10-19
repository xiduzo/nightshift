import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { WorkDelivery } from "@nightshift/api/context";
import type { AppRouterClient } from "@nightshift/api/routers/index";
import { user } from "@nightshift/db/schema/auth";
import { clone, hostLink, project } from "@nightshift/db/schema/nightshift";
import {
	createEngine,
	createOfferSlots,
	createSpaceDocuments,
	type Device,
	type DeviceOffer,
	type SessionInput,
	type SpaceDocuments,
	type WorkReply,
	type WorkRequest,
	worktreeLocation,
} from "@nightshift/engine";
import {
	createSandbox,
	type Sandbox,
	withDevice,
} from "@nightshift/engine/test-support";
import type { Engine } from "@nightshift/engine/types";
import { checkWork, createWorkServer } from "./work";
import { createWorkHub } from "./work-hub";

/**
 * The placed Device's own checks, from its Replica, before it starts
 * anything; and the Host's hub, which carries calls, replies and cancels
 * between a Walker and the Device that pulls its work.
 */

const HOST = "host-1";
const SPACE = "space-team";
/** This computer's owner, as the Host knows them. */
const ME = "person-on-host";
const RUN = "abcdef12-0000-0000-0000-000000000000";

let sandbox: Sandbox;
let engine: Engine;
let documents: SpaceDocuments;
let worktree: string;

beforeEach(async () => {
	sandbox = await createSandbox();
	own = [];
	documents = createSpaceDocuments({ db: sandbox.db });
	engine = createEngine(
		withDevice({
			db: sandbox.db,
			harnesses: {},
			deviceId: sandbox.deviceId,
			dataDir: sandbox.dataDir,
			scheduler: false,
			spaceDocuments: documents,
		}),
	);
	// This computer takes part in the Host's Space "Team", as a member.
	await sandbox.db.insert(hostLink).values({
		hostId: HOST,
		name: "studio",
		addresses: "[]",
		role: "home",
		personId: ME,
		keyStore: "file",
	});
	const [local] = await sandbox.db.select().from(user);
	await engine.exchange.hostSpaces.update(
		{ id: HOST, name: "studio" },
		[{ id: SPACE, name: "Team", personal: false, role: "member" }],
		local?.id as string,
	);
	const document = await documents.open(SPACE);
	document.doc.transact(() => {
		document.members.set(ME, { name: "Me", role: "member" });
		document.members.set("viewer", { name: "Viewer", role: "viewer" });
		document.members.set("colleague", { name: "Colleague", role: "member" });
	});
	// Its Clone of the Space's project.
	await sandbox.db
		.insert(project)
		.values({ id: "p1", spaceId: SPACE, name: "app" });
	await sandbox.db.insert(clone).values({
		id: "c1",
		spaceId: SPACE,
		projectId: "p1",
		deviceId: sandbox.deviceId,
		path: sandbox.repoPath,
	});
	worktree = worktreeLocation(sandbox.repoPath, RUN.slice(0, 8)).worktreePath;
});
afterEach(() => sandbox.cleanup());

const exec = (cwd: string): WorkRequest["call"] => ({
	kind: "exec",
	input: { command: "true", cwd },
});

function request(overrides: Partial<WorkRequest> = {}): WorkRequest {
	return {
		spaceId: SPACE,
		projectId: "p1",
		personId: ME,
		runId: RUN,
		call: exec(worktree),
		...overrides,
	};
}

/** This computer's own Offers (its Device document), per test. */
let own: DeviceOffer[] = [];
const DEVICE = { id: "device-b", name: "hetzner-1" };

const check = (r: WorkRequest) =>
	checkWork(r, {
		hostId: HOST,
		db: sandbox.db,
		engine,
		device: DEVICE,
		offers: () => own,
	});

/** The Host lists an Offer of this computer in the Space's document. */
async function listed(profile: string) {
	const document = await documents.open(SPACE);
	document.doc.transact(() => {
		document.offers.set(`${DEVICE.id}/${profile}`, {
			deviceId: DEVICE.id,
			deviceName: DEVICE.name,
			profile,
			permissionCap: "acceptEdits",
			sessionCap: 1,
			offeredAt: 1,
			by: ME,
		});
	});
}

const offered = (profile: string, cwd = worktree): WorkRequest["call"] => ({
	kind: "session",
	input: { cwd, prompt: "Do the work.", offered: { profile } },
});

describe("checkWork", () => {
	test("serves its owner's run, in the run's own folder", async () => {
		expect(await check(request())).toBeNull();
		expect(
			await check(request({ call: exec(join(worktree, "packages", "app")) })),
		).toBeNull();
		expect(
			await check(
				request({ runId: null, call: { kind: "capabilities", query: {} } }),
			),
		).toBeNull();
	});

	test("another Person's run takes an Offer in force, even when the Host is bypassed", async () => {
		const colleague = request({ personId: "colleague" });
		expect(await check({ ...colleague, call: offered("coder") })).toBe(
			"hetzner-1 offers nothing to this Space. Its owner can offer a profile on the Agents page.",
		);
		// Its own entry alone, or the Space's alone, is no Offer in force.
		own = [
			{
				spaceId: SPACE,
				profile: "coder",
				permissionCap: "acceptEdits",
				sessionCap: 1,
				offeredAt: 1,
			},
		];
		expect(await check({ ...colleague, call: offered("coder") })).toContain(
			"offers nothing",
		);
		own = [];
		await listed("coder");
		expect(await check({ ...colleague, call: offered("coder") })).toContain(
			"offers nothing",
		);
		own = [
			{
				spaceId: SPACE,
				profile: "coder",
				permissionCap: "acceptEdits",
				sessionCap: 1,
				offeredAt: 1,
			},
		];

		// In force: an offered session of it, and the run's own folder work.
		expect(await check({ ...colleague, call: offered("coder") })).toBeNull();
		expect(
			await check({
				...colleague,
				call: { kind: "worktree", run: { id: RUN, projectId: "p1" } },
			}),
		).toBeNull();
		expect(await check({ ...colleague, call: { kind: "flows" } })).toBeNull();

		// Anything else is refused.
		expect(await check({ ...colleague, call: offered("claude") })).toBe(
			'hetzner-1 offers "coder" to this Space, not "claude".',
		);
		for (const call of [
			exec(worktree),
			{ kind: "capabilities", query: {} },
			{
				kind: "callTool",
				input: { connection: "github", tool: "x", arguments: {} },
			},
			{
				kind: "session",
				input: {
					cwd: worktree,
					prompt: "Do the work.",
					harness: "claude-code",
					model: "sonnet",
					permissionMode: "bypassPermissions",
				},
			},
		] as WorkRequest["call"][]) {
			expect(await check({ ...colleague, call })).toBe(
				'hetzner-1 runs only the profiles its owner offers to this Space. hetzner-1 offers "coder" to this Space.',
			);
		}
		// Its own folder rules hold under an Offer too.
		expect(await check({ ...colleague, call: offered("coder", "/") })).toBe(
			"This device works only in the run's own folder.",
		);
	});

	test("another Person's run: a Member whose role uses Offers", async () => {
		own = [
			{
				spaceId: SPACE,
				profile: "coder",
				permissionCap: "acceptEdits",
				sessionCap: 1,
				offeredAt: 1,
			},
		];
		await listed("coder");
		expect(
			await check(request({ personId: "stranger", call: offered("coder") })),
		).toBe("This device runs steps for Members of this Space only.");
		expect(
			await check(request({ personId: "viewer", call: offered("coder") })),
		).toBe("Your role in this Space does not allow using what others offer.");
	});

	test("refuses a Space it does not take part in through this Host, and a role that does not start runs", async () => {
		expect(await check(request({ spaceId: sandbox.spaceId }))).toBe(
			"This device does not take part in that Space through this Host.",
		);
		await sandbox.db.$client.execute(
			"update host_link set person_id = 'viewer'",
		);
		expect(await check(request({ personId: "viewer" }))).toBe(
			"Your role in this Space does not allow starting runs.",
		);
	});

	test("refuses a project it has no Clone of, and a folder outside the run's worktree", async () => {
		expect(await check(request({ projectId: "elsewhere" }))).toBe(
			"This device does not have this project. Add its folder there first.",
		);
		for (const cwd of [sandbox.repoPath, `${worktree}-other`, "/"]) {
			expect(await check(request({ call: exec(cwd) }))).toBe(
				"This device works only in the run's own folder.",
			);
		}
		expect(
			await check(
				request({
					call: {
						kind: "worktree",
						run: { id: "another-run", projectId: "p1" },
					},
				}),
			),
		).toBe("This device adds a folder only for the run that asks.");
	});
});

/** A Host's side of the work stream, in memory: what it delivers, what comes back. */
function fakeHost() {
	const deliveries: WorkDelivery[] = [];
	let wake: (() => void) | null = null;
	const replies = new Map<string, WorkReply[]>();
	const done = new Set<string>();
	const client = {
		devices: {
			async work(_input: unknown, options: { signal: AbortSignal }) {
				const { signal } = options;
				return (async function* () {
					while (!signal.aborted) {
						const next = deliveries.shift();
						if (next) {
							yield next;
							continue;
						}
						await new Promise<void>((resolve) => {
							wake = resolve;
							signal.addEventListener("abort", () => resolve(), { once: true });
						});
					}
				})();
			},
			async workReply(input: {
				id: string;
				replies: WorkReply[];
				done: boolean;
			}) {
				replies.set(input.id, [
					...(replies.get(input.id) ?? []),
					...input.replies,
				]);
				if (input.done) done.add(input.id);
			},
		},
	} as unknown as AppRouterClient;
	return {
		client,
		replies,
		done,
		deliver(id: string, request: WorkRequest) {
			deliveries.push({ kind: "call", id, request });
			wake?.();
		},
	};
}

describe("the work server under an Offer", () => {
	test("runs the profile as its owner set it, the mode clamped to the cap; a session over the cap waits; withdrawing aborts it", async () => {
		own = [
			{
				spaceId: SPACE,
				profile: "coder",
				permissionCap: "acceptEdits",
				sessionCap: 1,
				offeredAt: 1,
			},
		];
		await listed("coder");
		/** The sessions this computer ran, and how to end each. */
		const sessions: { input: SessionInput; end: () => void }[] = [];
		const device = {
			...DEVICE,
			async *session(input: SessionInput) {
				let end = () => {};
				const ended = new Promise<void>((resolve) => {
					end = resolve;
					input.signal.addEventListener("abort", () => resolve(), {
						once: true,
					});
				});
				sessions.push({ input, end });
				yield { type: "ready", harness: input.harness };
				await ended;
			},
		} as unknown as Device;
		const server = createWorkServer({
			hostId: HOST,
			db: sandbox.db,
			engine,
			device,
			offers: () => own,
			profileFor: (name) =>
				name === "coder"
					? {
							harness: "claude-code",
							model: "sonnet",
							permissionMode: "bypassPermissions",
							clis: ["gh"],
							connections: [],
						}
					: null,
			slots: createOfferSlots(),
		});
		const host = fakeHost();
		const online = new AbortController();
		const serving = server.whileOnline(host.client, online.signal);
		const colleague = request({
			personId: "colleague",
			call: offered("coder"),
		});
		host.deliver("first", colleague);
		host.deliver("second", colleague);
		await waitUntil(() => sessions.length === 1);
		expect(sessions[0]?.input).toMatchObject({
			harness: "claude-code",
			model: "sonnet",
			permissionMode: "acceptEdits",
			clis: ["gh"],
			cwd: worktree,
			prompt: "Do the work.",
		});
		expect("offered" in (sessions[0]?.input ?? {})).toBe(false);
		await Bun.sleep(50);
		// The session cap is 1: the second waits for the first.
		expect(sessions).toHaveLength(1);
		sessions[0]?.end();
		await waitUntil(() => sessions.length === 2);
		await waitUntil(() => host.done.has("first"));

		server.withdrawn(SPACE, "coder");
		await waitUntil(() => host.done.has("second"));
		expect(sessions[1]?.input.signal.aborted).toBe(true);
		expect(server.running()).toBe(0);
		online.abort();
		await serving;
	});
});

async function waitUntil(ok: () => boolean, timeoutMs = 5_000) {
	const deadline = Date.now() + timeoutMs;
	while (!ok()) {
		if (Date.now() > deadline) throw new Error("Timed out.");
		await Bun.sleep(10);
	}
}

describe("the work hub", () => {
	test("a call reaches the Device that takes its work; its replies reach the caller; a cancel follows an abort", async () => {
		const hub = createWorkHub();
		expect(hub.online("b")).toBe(false);
		const refused = [];
		for await (const reply of hub.call("b", request())) refused.push(reply);
		expect(refused).toEqual([
			{ kind: "error", message: "The device of this run is offline." },
		]);

		const taking = new AbortController();
		const deliveries = hub.take("b", taking.signal)[Symbol.asyncIterator]();
		const first = deliveries.next();
		expect(hub.online("b")).toBe(true);

		const caller = new AbortController();
		const replies = hub
			.call("b", request(), caller.signal)
			[Symbol.asyncIterator]();
		const answered = replies.next();
		const call = (await first).value;
		expect(call).toMatchObject({ kind: "call", request: request() });
		// Another Device cannot answer it.
		hub.reply("c", {
			id: call.id,
			replies: [{ kind: "result", value: "forged" }],
			done: true,
		});
		hub.reply("b", {
			id: call.id,
			replies: [{ kind: "item", item: { type: "output" } }],
			done: false,
		});
		expect((await answered).value).toEqual({
			kind: "item",
			item: { type: "output" },
		});

		const cancelled = deliveries.next();
		caller.abort();
		expect((await replies.next()).done).toBe(true);
		expect((await cancelled).value).toEqual({ kind: "cancel", id: call.id });
		taking.abort();
	});

	test("a call the Device no longer serves when it comes back ends", async () => {
		const hub = createWorkHub();
		const first = new AbortController();
		const before = hub.take("b", first.signal)[Symbol.asyncIterator]();
		const delivered = before.next();
		const replies = hub.call("b", request())[Symbol.asyncIterator]();
		const answered = replies.next();
		await delivered;
		first.abort();
		await before.next();
		// It restarted: it serves nothing now.
		const again = new AbortController();
		const after = hub.take("b", again.signal, [])[Symbol.asyncIterator]();
		const next = after.next();
		expect((await answered).value).toEqual({
			kind: "error",
			message: "The device of this run stopped before the step ended.",
		});
		again.abort();
		await next;
	});

	test("a Device that stays away ends its calls", async () => {
		const hub = createWorkHub({ lostAfterMs: 20 });
		const taking = new AbortController();
		const deliveries = hub.take("b", taking.signal)[Symbol.asyncIterator]();
		const first = deliveries.next();
		const replies = hub.call("b", request())[Symbol.asyncIterator]();
		const answered = replies.next();
		await first;
		taking.abort();
		await deliveries.next();
		expect((await answered).value).toEqual({
			kind: "error",
			message: "The device of this run went offline.",
		});
		expect(hub.online("b")).toBe(false);
	});
});
