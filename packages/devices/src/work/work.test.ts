import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { clone, hostLink, project, user } from "@nightshift/db/schema";
import {
	createSpaceDocuments,
	type Device,
	type SessionInput,
	type SpaceDocuments,
	worktreeLocation,
} from "@nightshift/engine";
import { createSandbox, type Sandbox } from "@nightshift/engine/testing";
import type { WorkReply, WorkRequest } from "../contract";
import { httpsLink } from "../links/link";
import { createOfferAdmission, type DeviceOffer } from "../offers";
import { createPeerEngine, deviceDirectory, type PeerEngine } from "../peers";
import { partialHostClient, withPeers } from "../testing";
import { createWorkServer } from "./work";
import { createWorkHub } from "./work-hub";

/**
 * The placed Device's work server, which takes its Host's calls over its
 * Link and serves each through its Offer admission (`admission.test.ts`
 * has the checks); and the Host's hub, which carries calls, replies and
 * cancels between a Walker and the Device that pulls its work.
 */

const HOST = "host-1";
const SPACE = "space-team";
/** This computer's owner, as the Host knows them. */
const ME = "person-on-host";
const RUN = "abcdef12-0000-0000-0000-000000000000";

let sandbox: Sandbox;
let engine: PeerEngine;
let documents: SpaceDocuments;
let worktree: string;

beforeEach(async () => {
	sandbox = await createSandbox();
	own = [];
	documents = createSpaceDocuments({
		db: sandbox.db,
		directory: deviceDirectory(sandbox.db),
	});
	engine = createPeerEngine(
		withPeers({
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

/**
 * A Host's side of the work stream: a real work hub behind the two
 * procedures a placed Device calls, and this computer's link to it.
 */
function hubHost() {
	const hub = createWorkHub();
	const link = httpsLink({
		link: {
			hostId: HOST,
			name: "studio",
			addresses: ["memory"],
			certificate: null,
			fingerprint: null,
			role: "guest",
			personId: ME,
			keyStore: "file",
			createdAt: 0,
			revokedAt: null,
		},
		key: "nsd_key",
		clientFor: () =>
			partialHostClient({
				link: { hello: async () => hello, heartbeat: async () => hello },
				devices: {
					work: async (input, options) =>
						hub.take(DEVICE.id, options?.signal as AbortSignal, input?.running),
					workReply: async (input) => ({
						known: hub.reply(DEVICE.id, input),
					}),
				},
			}),
	});
	const hello = {
		host: { id: HOST, name: "studio", addresses: [] },
		deviceId: DEVICE.id,
		personId: ME,
		spaces: [],
	};
	return {
		hub,
		link,
		/** A call of the Host's Walker: its replies, until the call ends. */
		call(request: WorkRequest) {
			const replies: WorkReply[] = [];
			let done = false;
			void (async () => {
				for await (const reply of hub.call(DEVICE.id, request)) {
					replies.push(reply);
				}
				done = true;
			})();
			return { replies, done: () => done };
		},
	};
}

describe("the work server", () => {
	test("serves the Host's calls through the Offer admission: the profile as its owner set it, a session over the cap waits, withdrawing aborts it", async () => {
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
		const admission = createOfferAdmission({
			db: sandbox.db,
			device,
			documents,
			ownOffers: () => own,
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
		});
		const server = createWorkServer({
			serve: (request, signal) =>
				admission.serve(request, { hostId: HOST }, signal),
		});
		const host = hubHost();
		const detach = server.attach(host.link);
		await waitUntil(() => host.hub.online(DEVICE.id, "") === true);
		const colleague = request({
			personId: "colleague",
			call: offered("coder"),
		});
		const first = host.call(colleague);
		const second = host.call(colleague);
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
		await waitUntil(first.done);
		expect(first.replies[0]).toEqual({
			kind: "item",
			item: { type: "ready", harness: "claude-code" },
		});

		admission.withdrawn(SPACE, "coder");
		await waitUntil(second.done);
		expect(sessions[1]?.input.signal.aborted).toBe(true);
		expect(server.running()).toBe(0);
		detach();
		await host.link.close();
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
		expect(hub.online("b", "")).toBe(false);
		const refused = [];
		for await (const reply of hub.call("b", request())) refused.push(reply);
		expect(refused).toEqual([
			{
				kind: "error",
				message: "The device of this step is offline.",
				offline: true,
			},
		]);

		const taking = new AbortController();
		const deliveries = hub.take("b", taking.signal)[Symbol.asyncIterator]();
		const first = deliveries.next();
		expect(hub.online("b", "")).toBe(true);

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
			message: "The device of this step stopped before the step ended.",
			offline: true,
		});
		again.abort();
		await next;
	});

	test("a call the Device serves that the Host does not know (it restarted) is cancelled there", async () => {
		const hub = createWorkHub();
		const taking = new AbortController();
		const deliveries = hub
			.take("b", taking.signal, ["from-before"])
			[Symbol.asyncIterator]();
		expect((await deliveries.next()).value).toEqual({
			kind: "cancel",
			id: "from-before",
		});
		taking.abort();
		await deliveries.next();
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
			message: "The device of this step went offline.",
			offline: true,
		});
		expect(hub.online("b", "")).toBe(false);
	});
});
