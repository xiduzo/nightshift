import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { DeviceKeyAccess } from "@nightshift/auth";
import {
	member,
	project,
	projectSecret,
	run,
	spaceSecret,
	user,
} from "@nightshift/db/schema";
import type { Device } from "@nightshift/engine";
import {
	createSandbox,
	placesOn,
	type Sandbox,
} from "@nightshift/engine/testing";
import { asDate } from "@nightshift/time";
import type { WorkFor, WorkRequest } from "../contract";
import type { HostExchange } from "../exchange";
import { admitEvery } from "../testing";
import { linksTo } from "../testing/host-in-memory";
import { inMemoryHost } from "../testing/in-memory-host";
import { createWorkHub, serveWork } from "../work";
import { wireKept } from "./kept";
import {
	NOT_IN_SPACE,
	NOT_YOUR_STEP,
	OWNER_ONLY,
} from "./projects/domain/project-secrets";
import { KEY, secretsOf } from "./test-support";

let sandbox: Sandbox;
/** The Person who owns the sandbox's computer: an owner of its Space. */
let ownerId: string;
beforeEach(async () => {
	sandbox = await createSandbox();
	const [owner] = await sandbox.db.select().from(user);
	ownerId = owner?.id as string;
	// Ann may save Flows; Viv only reads; Olga and the stranger are no Members.
	for (const [id, name, role] of [
		["ann", "Ann", "member"],
		["viv", "Viv", "viewer"],
		["olga", "Olga", null],
		["stranger", "Stranger", null],
	] as const) {
		await sandbox.db
			.insert(user)
			.values({ id, name, email: `${id}@example.invalid` });
		if (role) {
			await sandbox.db.insert(member).values({
				id: `m-${id}`,
				organizationId: sandbox.spaceId,
				userId: id,
				role,
				createdAt: asDate(),
			});
		}
	}
	for (const id of ["app", "site"]) {
		await sandbox.db
			.insert(project)
			.values({ id, spaceId: sandbox.spaceId, name: id });
	}
	for (const [id, projectId, walkerId] of [
		["run-app", "app", "host"],
		["run-site", "site", "host"],
		["run-walked", "app", "laptop"],
	] as const) {
		await sandbox.db.insert(run).values({
			id,
			spaceId: sandbox.spaceId,
			projectId,
			flow: "{}",
			title: id,
			worktreePath: "/wt",
			branch: "b",
			baseRef: "main",
			walkerId,
		});
	}
});
afterEach(async () => {
	await sandbox.cleanup();
});

const kept = () =>
	wireKept({ db: sandbox.db, secretsKey: KEY, now: () => 1_000 });

/** A Device key of `deviceId`, for `personId`. */
const keyOf = (deviceId: string, personId: string): DeviceKeyAccess => ({
	keyId: `key-${deviceId}`,
	deviceId,
	personId,
	permissions: { sync: ["pull", "push"] },
});

/** A step of a run, as a Device asks for its Project's secrets. */
const stepOf = (runId: string, projectId = "app") => ({
	spaceId: sandbox.spaceId,
	projectId,
	runId,
});

describe("the store", () => {
	test("keeps each Project's values sealed, bound to the Project and the name", async () => {
		const s = kept().projects;
		await s.set(
			{ spaceId: sandbox.spaceId, projectId: "app" },
			"DB_URL",
			"postgres://app",
			"ann",
		);
		await s.set(
			{ spaceId: sandbox.spaceId, projectId: "site" },
			"DB_URL",
			"postgres://site",
			"ann",
		);
		expect(await s.list("app")).toEqual([
			{ name: "DB_URL", setAt: 1_000, setBy: "ann" },
		]);
		expect(await s.values("app")).toEqual({ DB_URL: "postgres://app" });
		expect(await s.values("site", ["DB_URL", "NONE"])).toEqual({
			DB_URL: "postgres://site",
		});
		const rows = await sandbox.db.select().from(projectSecret);
		expect(JSON.stringify(rows)).not.toContain("postgres://");
		// A row copied to another Project does not open there.
		const [row] = rows.filter((r) => r.projectId === "app");
		await sandbox.db.delete(projectSecret);
		await sandbox.db.insert(projectSecret).values({
			...(row as typeof projectSecret.$inferInsert),
			projectId: "site",
		});
		expect(await s.values("site")).toEqual({});
	});

	test("a Space's value does not open as another Space's", async () => {
		const space = kept().spaces;
		await space.set(sandbox.spaceId, "TOKEN", "secret-value", "ann");
		const rows = await sandbox.db.select().from(spaceSecret);
		expect(JSON.stringify(rows)).not.toContain("secret-value");
		const [row] = rows;
		await sandbox.db.delete(spaceSecret);
		await sandbox.db.insert(spaceSecret).values({
			...(row as typeof spaceSecret.$inferInsert),
			spaceId: "other",
		});
		expect(await space.values("other")).toEqual({});
	});
});

describe("the work hub knows which Device runs a step of which run now", () => {
	test("a session out to a Device is placed until it ends", async () => {
		const hub = createWorkHub();
		const stop = new AbortController();
		const taken = hub.take("laptop", stop.signal)[Symbol.asyncIterator]();
		// The Device takes work: its stream is open before the call.
		const next = taken.next();
		const request: WorkRequest = {
			...stepOf("run-app"),
			personId: "ann",
			call: {
				kind: "exec",
				input: { command: "true", cwd: "/wt" },
			},
		};
		const call = new AbortController();
		const replies = hub
			.call("laptop", request, call.signal)
			[Symbol.asyncIterator]();
		const pending = replies.next();
		const delivery = await next;
		expect(delivery.value).toMatchObject({ kind: "call" });
		expect(hub.placed("laptop", stepOf("run-app"))).toBe(true);
		expect(hub.placed("laptop", stepOf("run-site", "site"))).toBe(false);
		expect(hub.placed("phone", stepOf("run-app"))).toBe(false);
		const id = (delivery.value as { id: string }).id;
		hub.reply("laptop", { id, replies: [], done: true });
		await pending;
		expect(hub.placed("laptop", stepOf("run-app"))).toBe(false);
		stop.abort();
	});
});

describe("the placed Device takes the run from the request, never from the call", () => {
	test("a command's run is the request's own", async () => {
		const seen: unknown[] = [];
		const device = {
			async *exec(input: Parameters<Device["exec"]>[0]) {
				seen.push(input.run);
				yield { type: "exit", exitCode: 0, spawnError: null } as const;
			},
		} as unknown as Device;
		const forRun: WorkFor = { ...stepOf("run-app"), personId: "ann" };
		const replies = serveWork(
			device,
			{
				...forRun,
				call: {
					kind: "exec",
					input: {
						command: "true",
						cwd: "/wt",
						// A Walker that names another run is not believed.
						run: stepOf("run-site", "site"),
					},
				},
			},
			new AbortController().signal,
		);
		for await (const _ of replies) {
			// Drained.
		}
		const before = serveWork(
			device,
			{
				...forRun,
				runId: null,
				call: {
					kind: "exec",
					input: {
						command: "true",
						cwd: "/wt",
						run: stepOf("run-site", "site"),
					},
				},
			},
			new AbortController().signal,
		);
		for await (const _ of before) {
			// Drained.
		}
		expect(seen).toEqual([stepOf("run-app"), undefined]);
	});
});

describe("the Device's half", () => {
	test("in a Space this computer keeps, its own store, after the same checks", async () => {
		const projects = secretsOf({
			db: sandbox.db,
			places: placesOn(sandbox.db),
			ownerId,
		}).projectSecrets;
		const app = { spaceId: sandbox.spaceId, projectId: "app" };
		await projects.set(app, "DB_URL", "postgres://x", "ann");
		expect((await projects.list(app, "viv")).map((s) => s.name)).toEqual([
			"DB_URL",
		]);
		await expect(projects.set(app, "DB_URL", "y", "viv")).rejects.toThrow(
			"Your role in this Space does not allow this.",
		);
		await expect(projects.list(app, "stranger")).rejects.toThrow(NOT_IN_SPACE);
		expect(await projects.values(stepOf("run-app"), ["DB_URL"])).toEqual({
			DB_URL: "postgres://x",
		});
		// A run of another Project gets none of these.
		await expect(
			projects.values(stepOf("run-site"), ["DB_URL"]),
		).rejects.toThrow(NOT_YOUR_STEP);
		expect(await projects.kept(app)).toEqual(["postgres://x"]);
		expect(await projects.kept(app, ["DB_URL"])).toEqual(["postgres://x"]);
		expect(await projects.kept(app, ["OTHER"])).toEqual([]);
		expect(await projects.take(app, "DB_URL", "ann")).toBe("postgres://x");
	});

	test("in a Space a Host keeps, each call goes there with this Device's key, as its owner only", async () => {
		const hostSandbox = sandbox;
		const hostStore = kept().projects;
		const hostSpaceStore = kept().spaces;
		const placed = new Set<string>();
		const host = inMemoryHost({
			exchange: {} as HostExchange,
			hello: () => Promise.reject(new Error("No hello in this test.")),
			// The Host admits the laptop as paired here, of a Member of the Space.
			admit: admitEvery({ roles: { [sandbox.spaceId]: "member" } }),
			projectSecrets: secretsOf({
				db: hostSandbox.db,
				places: placesOn(hostSandbox.db),
				work: {
					...createWorkHub(),
					placed: (deviceId, step) => placed.has(`${deviceId}/${step.runId}`),
				},
			}).ofDevices.projectSecrets,
		});
		const client = host.client(keyOf("laptop", "ann"));
		const projects = secretsOf({
			// This Device's own records: the Host keeps the Space.
			db: hostSandbox.db,
			places: placesOn(hostSandbox.db),
			hostOf: async () => "host",
			links: () => linksTo(new Map([["host", client]])),
			ownerId: "local-ann",
		}).projectSecrets;
		const app = { spaceId: sandbox.spaceId, projectId: "app" };
		await projects.set(app, "DB_URL", "postgres://x", "local-ann");
		expect(await hostStore.values("app")).toEqual({ DB_URL: "postgres://x" });
		// Set by the key's Person, as the Host knows them.
		expect((await projects.list(app, "local-ann"))[0]?.setBy).toEqual({
			id: "ann",
			name: "Ann",
		});
		// Someone else on this computer does not act through its key.
		await expect(projects.set(app, "DB_URL", "y", "viv")).rejects.toThrow(
			OWNER_ONLY,
		);
		// A step gets values only while it runs here, as the Host sees it.
		await expect(projects.values(stepOf("run-app"))).rejects.toThrow(
			NOT_YOUR_STEP,
		);
		placed.add("laptop/run-app");
		expect(await projects.values(stepOf("run-app"))).toEqual({
			DB_URL: "postgres://x",
		});
		// This computer keeps none of them: the kept values are the Host's.
		expect(await projects.kept(app)).toEqual([]);
		// A Space's secrets go the same way, and a step reads them with the Project's.
		const spaceId = sandbox.spaceId;
		await projects.space.set(spaceId, "TOKEN", "space-token", "local-ann");
		expect(await hostSpaceStore.values(spaceId)).toEqual({
			TOKEN: "space-token",
		});
		expect((await projects.space.list(spaceId, "local-ann"))[0]?.name).toBe(
			"TOKEN",
		);
		expect(await projects.values(stepOf("run-app"))).toEqual({
			DB_URL: "postgres://x",
			TOKEN: "space-token",
		});
		expect(await projects.space.take(spaceId, "TOKEN", "local-ann")).toBe(
			"space-token",
		);
		await expect(
			projects.space.set(spaceId, "TOKEN", "y", "viv"),
		).rejects.toThrow(OWNER_ONLY);
		await projects.space.remove(spaceId, "TOKEN", "local-ann");
		expect(await hostSpaceStore.values(spaceId)).toEqual({});
		host.down();
		await expect(projects.values(stepOf("run-app"))).rejects.toThrow();
	});
});
