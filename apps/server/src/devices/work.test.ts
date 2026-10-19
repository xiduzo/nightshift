import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { user } from "@nightshift/db/schema/auth";
import { clone, hostLink, project } from "@nightshift/db/schema/nightshift";
import {
	createEngine,
	createSpaceDocuments,
	type WorkRequest,
	worktreeLocation,
} from "@nightshift/engine";
import {
	createSandbox,
	type Sandbox,
	withDevice,
} from "@nightshift/engine/test-support";
import type { Engine } from "@nightshift/engine/types";
import { checkWork } from "./work";
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
let worktree: string;

beforeEach(async () => {
	sandbox = await createSandbox();
	const documents = createSpaceDocuments({ db: sandbox.db });
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

const check = (r: WorkRequest) =>
	checkWork(r, { hostId: HOST, db: sandbox.db, engine });

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

	test("refuses another Person's run: that takes an Offer", async () => {
		expect(await check(request({ personId: "colleague" }))).toBe(
			"This device runs steps for its owner's runs only.",
		);
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
