import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { DeviceKeyAccess } from "@nightshift/auth";
import {
	member,
	project,
	projectSecret,
	run,
	user,
} from "@nightshift/db/schema";
import type { Device } from "@nightshift/engine";
import { createSandbox, type Sandbox } from "@nightshift/engine/testing";
import { asDate } from "@nightshift/time";
import type { WorkFor, WorkRequest } from "../contract";
import type { HostExchange } from "../exchange";
import type { PairedDevice } from "../registry";
import { linksTo } from "../testing/host-in-memory";
import { inMemoryHost } from "../testing/in-memory-host";
import { createWorkHub, serveWork } from "../work";
import { secretsCipher } from "./cipher";
import { NOT_YOUR_DEVICE } from "./host";
import { deviceProjectSecrets, OWNER_ONLY } from "./project-device";
import {
	createProjectSecretsHost,
	NOT_A_PROJECT_HERE,
	NOT_IN_SPACE,
	NOT_YOUR_STEP,
} from "./project-host";
import { createProjectSecretStore } from "./project-store";

const KEY = "a-secrets-key-for-these-tests-0123456789";

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

const store = () =>
	createProjectSecretStore({
		db: sandbox.db,
		cipher: secretsCipher(KEY),
		now: () => 1_000,
	});

/** A Device as this Host's registry has it. */
function paired(fields: Partial<PairedDevice> = {}): PairedDevice {
	return {
		id: "laptop",
		name: "Laptop",
		platform: "darwin",
		ownerId: "ann",
		homeHost: null,
		lastSeenAt: null,
		online: true,
		pairedAt: 0,
		revokedAt: null,
		...fields,
	};
}

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
		const s = store();
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
});

describe("the Host's half", () => {
	/** The calls out to placed Devices: which Device runs a step of which run now. */
	let placed: { deviceId: string; runId: string; projectId: string }[];
	beforeEach(() => {
		placed = [];
	});

	function hostOver(
		devices: PairedDevice[],
		options: {
			isHost?: boolean;
			keptBy?: string | null;
			offering?: string[];
		} = {},
	) {
		const s = store();
		const host = createProjectSecretsHost({
			db: sandbox.db,
			registry: {
				get: async (id) => devices.find((d) => d.id === id) ?? null,
			},
			store: s,
			isHost: () => options.isHost ?? true,
			hostOf: async () => options.keptBy ?? null,
			work: {
				placed: (deviceId, step) =>
					placed.some(
						(p) =>
							p.deviceId === deviceId &&
							p.runId === step.runId &&
							p.projectId === step.projectId,
					),
			},
			offersInto: async (deviceId) =>
				(options.offering ?? []).includes(deviceId),
		});
		return { s, host };
	}

	const app = () => ({ spaceId: sandbox.spaceId, projectId: "app" });

	test("a Member who saves Flows sets a value; Members list names with who and when", async () => {
		const { s, host } = hostOver([
			paired(),
			paired({ id: "vivs-pc", ownerId: "viv" }),
		]);
		await host.set(keyOf("laptop", "ann"), {
			...app(),
			name: "DB_URL",
			value: "postgres://x",
		});
		expect(await s.values("app")).toEqual({ DB_URL: "postgres://x" });
		const listed = [
			{ name: "DB_URL", setAt: 1_000, setBy: { id: "ann", name: "Ann" } },
		];
		expect(await host.list(keyOf("laptop", "ann"), app())).toEqual(listed);
		// A viewer reads the names, never a value, and changes nothing.
		const viv = keyOf("vivs-pc", "viv");
		expect(await host.list(viv, app())).toEqual(listed);
		await expect(
			host.set(viv, { ...app(), name: "DB_URL", value: "stolen" }),
		).rejects.toThrow("Your role in this Space does not allow this.");
		await expect(host.take(viv, { ...app(), name: "DB_URL" })).rejects.toThrow(
			"Your role in this Space does not allow this.",
		);
		await expect(
			host.remove(viv, { ...app(), name: "DB_URL" }),
		).rejects.toThrow("Your role in this Space does not allow this.");
		expect(await s.values("app")).toEqual({ DB_URL: "postgres://x" });
		// A move reads it once, for a Person who may save Flows.
		expect(
			await host.take(keyOf("laptop", "ann"), { ...app(), name: "DB_URL" }),
		).toBe("postgres://x");
		await host.remove(keyOf("laptop", "ann"), { ...app(), name: "DB_URL" });
		expect(await s.list("app")).toEqual([]);
	});

	test("a Device with a step of the run placed on it gets the run's Project values, for that run only", async () => {
		const { s, host } = hostOver([paired()]);
		await s.set(app(), "DB_URL", "postgres://app", "ann");
		await s.set(
			{ spaceId: sandbox.spaceId, projectId: "site" },
			"SITE_KEY",
			"site",
			"ann",
		);
		const ann = keyOf("laptop", "ann");
		// Nothing of the run runs there now.
		await expect(host.values(ann, stepOf("run-app"))).rejects.toThrow(
			NOT_YOUR_STEP,
		);
		placed.push({ deviceId: "laptop", runId: "run-app", projectId: "app" });
		expect(await host.values(ann, stepOf("run-app"))).toEqual({
			DB_URL: "postgres://app",
		});
		expect(
			await host.values(ann, { ...stepOf("run-app"), names: ["NONE"] }),
		).toEqual({});
		// Another Project through this run, or a run of another Project.
		await expect(host.values(ann, stepOf("run-app", "site"))).rejects.toThrow(
			NOT_YOUR_STEP,
		);
		await expect(host.values(ann, stepOf("run-site", "site"))).rejects.toThrow(
			NOT_YOUR_STEP,
		);
	});

	test("the Device that walks the run itself gets its Project's values", async () => {
		const { s, host } = hostOver([paired()]);
		await s.set(app(), "DB_URL", "postgres://app", "ann");
		expect(
			await host.values(keyOf("laptop", "ann"), stepOf("run-walked")),
		).toEqual({ DB_URL: "postgres://app" });
	});

	test("another Person's Device under an Offer gets the run's Project values, for that run only", async () => {
		const { s, host } = hostOver(
			[paired({ id: "olgas-pc", ownerId: "olga" })],
			{
				offering: ["olgas-pc"],
			},
		);
		await s.set(app(), "DB_URL", "postgres://app", "ann");
		await s.set(
			{ spaceId: sandbox.spaceId, projectId: "site" },
			"SITE_KEY",
			"site",
			"ann",
		);
		placed.push({ deviceId: "olgas-pc", runId: "run-app", projectId: "app" });
		const olga = keyOf("olgas-pc", "olga");
		expect(await host.values(olga, stepOf("run-app"))).toEqual({
			DB_URL: "postgres://app",
		});
		await expect(host.values(olga, stepOf("run-site", "site"))).rejects.toThrow(
			NOT_YOUR_STEP,
		);
		// No Member: the names are not hers to list or change.
		await expect(host.list(olga, app())).rejects.toThrow(NOT_IN_SPACE);
	});

	test.each([
		[
			"a Device whose Person is no Member and offers nothing",
			paired({ id: "strangers-pc", ownerId: "stranger" }),
			keyOf("strangers-pc", "stranger"),
			NOT_IN_SPACE,
		],
		[
			"a Device whose access is removed",
			paired({ revokedAt: 5 }),
			keyOf("laptop", "ann"),
			NOT_YOUR_DEVICE,
		],
		[
			"a key whose Person does not own the Device",
			paired(),
			keyOf("laptop", "viv"),
			NOT_YOUR_DEVICE,
		],
	] as const)(
		"refuses %s, even with a step placed on it",
		async (_, device, key, words) => {
			const { s, host } = hostOver([device]);
			await s.set(app(), "DB_URL", "postgres://app", "ann");
			placed.push({ deviceId: device.id, runId: "run-app", projectId: "app" });
			await expect(host.values(key, stepOf("run-app"))).rejects.toThrow(words);
			await expect(
				host.set(key, { ...app(), name: "DB_URL", value: "stolen" }),
			).rejects.toThrow(words);
			expect(await s.values("app")).toEqual({ DB_URL: "postgres://app" });
		},
	);

	test("refuses a Project of a Space another Host keeps, and every call while Be a Host is off", async () => {
		placed.push({ deviceId: "laptop", runId: "run-app", projectId: "app" });
		const elsewhere = hostOver([paired()], { keptBy: "another-host" }).host;
		await expect(
			elsewhere.values(keyOf("laptop", "ann"), stepOf("run-app")),
		).rejects.toThrow(NOT_A_PROJECT_HERE);
		await expect(elsewhere.list(keyOf("laptop", "ann"), app())).rejects.toThrow(
			NOT_A_PROJECT_HERE,
		);
		const off = hostOver([paired()], { isHost: false }).host;
		await expect(off.list(keyOf("laptop", "ann"), app())).rejects.toThrow(
			"Be a Host",
		);
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
		const here = store();
		const projects = deviceProjectSecrets({
			db: sandbox.db,
			hostSpaces: { hostOf: async () => null },
			links: () => linksTo(new Map()),
			store: here,
			ownerId,
		});
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
		const hostStore = store();
		const placed = new Set<string>();
		const host = inMemoryHost({
			exchange: {} as HostExchange,
			hello: () => Promise.reject(new Error("No hello in this test.")),
			projectSecrets: createProjectSecretsHost({
				db: hostSandbox.db,
				registry: { get: async () => paired() },
				store: hostStore,
				isHost: () => true,
				hostOf: async () => null,
				work: {
					placed: (deviceId, step) => placed.has(`${deviceId}/${step.runId}`),
				},
				offersInto: async () => false,
			}),
		});
		const client = host.client(keyOf("laptop", "ann"));
		const projects = deviceProjectSecrets({
			// This Device's own records: the Host keeps the Space.
			db: hostSandbox.db,
			hostSpaces: { hostOf: async () => "host" },
			links: () => linksTo(new Map([["host", client]])),
			store: store(),
			ownerId: "local-ann",
		});
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
		host.down();
		await expect(projects.values(stepOf("run-app"))).rejects.toThrow();
	});
});
