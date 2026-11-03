import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { DeviceKeyAccess } from "@nightshift/auth";
import type {
	PersonalSecrets,
	ProjectSecrets,
} from "@nightshift/engine/device-config";
import {
	createConnectionStore,
	createSandbox,
	type Sandbox,
} from "@nightshift/engine/testing";
import { Refusal } from "@nightshift/refusal";
import { ORPCError } from "@orpc/server";
import {
	type HostClient,
	type SecretMove,
	UNREADABLE_REQUEST,
	type WorkReply,
	type WorkRequest,
	workRequestSchema,
} from "../contract";
import type { HostExchange } from "../exchange";
import type { HostLink } from "../links";
import type { PairedDevice } from "../registry";
import { partialHostClient } from "../testing";
import { linksTo } from "../testing/host-in-memory";
import { inMemoryHost } from "../testing/in-memory-host";
import { createWorkHub, createWorkServer, type WorkHub } from "../work";
import {
	createSecretMovesHost,
	deviceSecretMoves,
	NOT_HOME_FOR_MOVES,
	NOT_YOUR_OTHER_DEVICE,
	OLDER_HOST_MOVES,
	ONLY_FOR_OWNER,
	ONLY_FROM_HOME,
	type OwnSecrets,
	serveSecretCall,
} from "./moves";

/**
 * A secret saved on another of the Person's Devices moves without anyone
 * typing it again (ADR 13, decision 7): the Device that asks goes through
 * its Home Host, which sends the Device with the value a secret call over
 * that Device's own work stream. That Device reads its keychain, saves the
 * value in the new scope, then removes its copy and its Device document's
 * name.
 */

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await sandbox.cleanup();
});

const HOST = "home-host";

/** A Device as the Home Host's registry has it: Ann's laptop, by default. */
function paired(fields: Partial<PairedDevice> = {}): PairedDevice {
	return {
		id: "laptop",
		name: "LE2316",
		platform: "darwin",
		ownerId: "ann",
		homeHost: "https://host.example.com",
		lastSeenAt: null,
		online: true,
		pairedAt: 0,
		revokedAt: null,
		...fields,
	};
}

/** Ann's Mac, which asks; her laptop, which has the value; Bob's PC; Ann's Mac on a guest Host. */
const DEVICES = [
	paired({ id: "mac", name: "Mac" }),
	paired(),
	paired({ id: "pc", name: "PC", ownerId: "bob" }),
	paired({ id: "guest-mac", name: "Guest Mac", homeHost: null }),
];
const registry = {
	get: async (id: string) => DEVICES.find((d) => d.id === id) ?? null,
};

const keyOf = (deviceId: string, personId: string): DeviceKeyAccess => ({
	keyId: `key-${deviceId}`,
	deviceId,
	personId,
	permissions: { sync: ["pull", "push"] },
});

/** A link of a Device to its Host, as it stores it. */
function linkTo(hostId: string, personId = "ann"): HostLink {
	return {
		hostId,
		name: "Home",
		addresses: ["https://host.example.com"],
		certificate: null,
		fingerprint: null,
		role: "home",
		personId,
		keyStore: "file",
		createdAt: 0,
		revokedAt: null,
	};
}

/** The keychain of the laptop, in memory. */
function memorySecrets(initial: Record<string, string>) {
	const values = new Map(Object.entries(initial));
	return {
		values,
		backend: {
			get: async (name: string) => values.get(name) ?? null,
			set: async (name: string, value: string) => {
				values.set(name, value);
			},
			delete: async (name: string) => {
				values.delete(name);
			},
		},
	};
}

/** The Personal secrets as the laptop reaches them: at its Home Host, here a map. */
function personalAt(fail?: () => Error) {
	const kept = new Map<string, string>();
	const port: PersonalSecrets = {
		list: async () => [...kept.keys()].map((name) => ({ name, setAt: 1 })),
		values: async (names) =>
			Object.fromEntries(
				names.flatMap((n) => (kept.has(n) ? [[n, kept.get(n) as string]] : [])),
			),
		set: async (name, value) => {
			if (fail) throw fail();
			kept.set(name, value);
		},
		remove: async (name) => {
			kept.delete(name);
		},
	};
	return { kept, port };
}

/** The Project secrets as the laptop reaches them: what it saved, and as whom. */
function projectsAt() {
	const saved: { project: unknown; name: string; value: string; by: string }[] =
		[];
	const port = {
		set: async (project, name, value, personId) => {
			saved.push({ project, name, value, by: personId });
		},
	} as Pick<ProjectSecrets, "set"> as ProjectSecrets;
	return { saved, port };
}

/**
 * The laptop: its own connection store over its Device document, with
 * GH_TOKEN saved in its keychain, and the secret calls it serves.
 */
async function laptop(options: { fail?: () => Error; personId?: string } = {}) {
	const keychain = memorySecrets({});
	const personal = personalAt(options.fail);
	const projects = projectsAt();
	const document = await sandbox.openDocument();
	const store = createConnectionStore({
		document,
		env: {},
		secrets: keychain.backend,
		personal: () => personal.port,
		projects: () => projects.port,
	});
	await store.setSecret("GH_TOKEN", "ghp_laptop");
	const serve = serveSecretCall({
		hostLinks: { home: async () => linkTo(HOST, options.personId) },
		own: store,
		ownerId: "local-ann",
	});
	/** The secret names its Device document lists. */
	const names = () =>
		(
			(document.facts.get("secrets") as { name: string }[] | undefined) ?? []
		).map((s) => s.name);
	return { keychain, personal, projects, serve, names, store };
}

/** The laptop takes its work from the Home Host's hub over its own stream, as its work server does. */
function attach(
	hub: WorkHub,
	serve: (request: WorkRequest) => AsyncIterable<WorkReply>,
): () => void {
	const client = partialHostClient({
		devices: {
			work: async (input, options) =>
				hub.take("laptop", options?.signal as AbortSignal, input?.running),
			workReply: async (input) => ({ known: hub.reply("laptop", input) }),
		},
	});
	return createWorkServer({ serve }).attach({
		stream: (_name, open) => {
			const controller = new AbortController();
			void open(client, controller.signal).catch(() => {});
			return () => controller.abort();
		},
		ready: async () => client,
	});
}

async function until(check: () => boolean): Promise<void> {
	for (let i = 0; i < 200 && !check(); i++) await Bun.sleep(5);
	expect(check()).toBe(true);
}

/** Ann's Mac, which asks through its Home Host with its own key. */
function macThrough(client: HostClient) {
	return deviceSecretMoves({
		registry: { get: async () => null },
		work: createWorkHub(),
		hostLinks: { home: async () => linkTo(HOST) },
		links: () => linksTo(new Map([[HOST, client]])),
		ownerId: "local-ann",
	});
}

/** The Home Host, with its hub and its router in memory. It is Ann's, and keeps secrets of its own (`own`). */
function homeHost(own?: OwnSecrets) {
	const hub = createWorkHub();
	const host = inMemoryHost({
		exchange: {} as HostExchange,
		hello: () => Promise.reject(new Error("No hello in this test.")),
		secretMoves: createSecretMovesHost({
			registry,
			work: hub,
			isHost: () => true,
			self: { id: "studio", ownerId: "ann", own },
		}),
	});
	return { hub, host };
}

async function refusalOf(promise: Promise<unknown>): Promise<string> {
	try {
		await promise;
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
	throw new Error("It was not refused.");
}

describe("moving a secret saved on another device", () => {
	test("the owner's Mac asks; the laptop moves its own value to Personal and lists it no more", async () => {
		const { hub, host } = homeHost();
		const device = await laptop();
		const detach = attach(hub, (request) =>
			device.serve(request, { hostId: HOST }),
		);
		try {
			await until(() => hub.online("laptop", "") === true);
			expect(device.names()).toEqual(["GH_TOKEN"]);
			await macThrough(host.client(keyOf("mac", "ann"))).move(
				"laptop",
				"GH_TOKEN",
				{ to: "personal" },
			);
			expect(device.personal.kept.get("GH_TOKEN")).toBe("ghp_laptop");
			// Its own copy went after the save, and its document says so.
			expect(device.keychain.values.has("GH_TOKEN")).toBe(false);
			expect(device.names()).toEqual([]);
		} finally {
			detach();
		}
	});

	test("into a project: the laptop saves it as its owner, then removes its copy", async () => {
		const { hub, host } = homeHost();
		const device = await laptop();
		const detach = attach(hub, (request) =>
			device.serve(request, { hostId: HOST }),
		);
		try {
			await until(() => hub.online("laptop", "") === true);
			const move: SecretMove = {
				to: "project",
				spaceId: "team",
				projectId: "api",
			};
			await macThrough(host.client(keyOf("mac", "ann"))).move(
				"laptop",
				"GH_TOKEN",
				move,
			);
			expect(device.projects.saved).toEqual([
				{
					project: { spaceId: "team", projectId: "api" },
					name: "GH_TOKEN",
					value: "ghp_laptop",
					// The laptop's owner as the laptop knows them: its Host checks the role.
					by: "local-ann",
				},
			]);
			expect(device.keychain.values.has("GH_TOKEN")).toBe(false);
			expect(device.names()).toEqual([]);
		} finally {
			detach();
		}
	});

	test("Remove from the laptop: its copy and its name go", async () => {
		const { hub, host } = homeHost();
		const device = await laptop();
		const detach = attach(hub, (request) =>
			device.serve(request, { hostId: HOST }),
		);
		try {
			await until(() => hub.online("laptop", "") === true);
			await macThrough(host.client(keyOf("mac", "ann"))).move(
				"laptop",
				"GH_TOKEN",
				{ to: "removed" },
			);
			expect(device.keychain.values.has("GH_TOKEN")).toBe(false);
			expect(device.names()).toEqual([]);
			expect(device.personal.kept.size).toBe(0);
		} finally {
			detach();
		}
	});

	test("the keychain copy stays when the save in the new scope fails", async () => {
		const { hub, host } = homeHost();
		const device = await laptop({
			fail: () => new Refusal("unavailable", "The home Host did not answer."),
		});
		const detach = attach(hub, (request) =>
			device.serve(request, { hostId: HOST }),
		);
		try {
			await until(() => hub.online("laptop", "") === true);
			expect(
				await refusalOf(
					macThrough(host.client(keyOf("mac", "ann"))).move(
						"laptop",
						"GH_TOKEN",
						{ to: "personal" },
					),
				),
			).toBe("The home Host did not answer.");
			expect(device.keychain.values.get("GH_TOKEN")).toBe("ghp_laptop");
			expect(device.names()).toEqual(["GH_TOKEN"]);
		} finally {
			detach();
		}
	});

	test("only the owner asks: another Person, a Device of another Person, a guest Device", async () => {
		const { hub, host } = homeHost();
		const device = await laptop();
		const detach = attach(hub, (request) =>
			device.serve(request, { hostId: HOST }),
		);
		try {
			await until(() => hub.online("laptop", "") === true);
			const ask = (deviceId: string, personId: string) =>
				refusalOf(
					macThrough(host.client(keyOf(deviceId, personId))).move(
						"laptop",
						"GH_TOKEN",
						{ to: "personal" },
					),
				);
			// Bob's PC, for Ann's laptop.
			expect(await ask("pc", "bob")).toBe(NOT_YOUR_OTHER_DEVICE);
			// A key that names another Person than the Device's owner.
			expect(await ask("mac", "bob")).toContain("Pair it again");
			// Ann's Mac that joined this Host as a guest.
			expect(await ask("guest-mac", "ann")).toBe(NOT_HOME_FOR_MOVES);
			// Nothing reached the laptop.
			expect(device.keychain.values.get("GH_TOKEN")).toBe("ghp_laptop");
			expect(device.personal.kept.size).toBe(0);
		} finally {
			detach();
		}
	});

	test("the laptop serves a secret call from its Home Host only, for its own Person only", async () => {
		const device = await laptop();
		const request: WorkRequest = {
			spaceId: "",
			projectId: "",
			personId: "ann",
			runId: null,
			call: { kind: "secret", name: "GH_TOKEN", move: { to: "personal" } },
		};
		const replies = async (
			req: WorkRequest,
			via: { hostId: string },
		): Promise<WorkReply[]> => {
			const out: WorkReply[] = [];
			for await (const reply of device.serve(req, via)) out.push(reply);
			return out;
		};
		expect(await replies(request, { hostId: "guest-host" })).toEqual([
			{ kind: "error", message: ONLY_FROM_HOME },
		]);
		expect(
			await replies({ ...request, personId: "bob" }, { hostId: HOST }),
		).toEqual([{ kind: "error", message: ONLY_FOR_OWNER }]);
		expect(device.keychain.values.get("GH_TOKEN")).toBe("ghp_laptop");
		// A Walker's call of a run cannot carry one.
		expect(workRequestSchema.safeParse(request).success).toBe(false);
	});

	test("an offline laptop is refused at once, in words for people", async () => {
		const { host } = homeHost();
		const mac = macThrough(host.client(keyOf("mac", "ann")));
		expect(
			await refusalOf(mac.move("laptop", "GH_TOKEN", { to: "personal" })),
		).toBe("LE2316 is offline. Move it when LE2316 is online.");
		expect(
			await refusalOf(mac.move("laptop", "GH_TOKEN", { to: "removed" })),
		).toBe("LE2316 is offline. Remove it when LE2316 is online.");
	});

	test("an older laptop cannot read the call: update it", async () => {
		const { hub, host } = homeHost();
		// A work server of an older version answers what it cannot read so.
		const detach = attach(hub, async function* () {
			yield { kind: "error", message: UNREADABLE_REQUEST };
		});
		try {
			await until(() => hub.online("laptop", "") === true);
			expect(
				await refusalOf(
					macThrough(host.client(keyOf("mac", "ann"))).move(
						"laptop",
						"GH_TOKEN",
						{ to: "personal" },
					),
				),
			).toBe("Update Night Shift on LE2316 to move its secrets from here.");
		} finally {
			detach();
		}
	});

	test("an older Home Host does not know the call: update it", async () => {
		const older = partialHostClient({
			secrets: {
				moveOnDevice: () =>
					Promise.reject(new ORPCError("NOT_FOUND", { status: 404 })),
			},
		});
		expect(
			await refusalOf(
				macThrough(older).move("laptop", "GH_TOKEN", { to: "personal" }),
			),
		).toBe(OLDER_HOST_MOVES);
	});

	test("on the Home Host itself, the call goes from its own hub", async () => {
		const hub = createWorkHub();
		const device = await laptop();
		const detach = attach(hub, (request) =>
			device.serve(request, { hostId: HOST }),
		);
		try {
			await until(() => hub.online("laptop", "") === true);
			const moves = deviceSecretMoves({
				registry,
				work: hub,
				hostLinks: { home: async () => null },
				links: () => linksTo(new Map()),
				// The Host's owner, as its own registry knows them.
				ownerId: "ann",
			});
			await moves.move("laptop", "GH_TOKEN", { to: "personal" });
			expect(device.personal.kept.get("GH_TOKEN")).toBe("ghp_laptop");
			// Bob's PC is not the owner's.
			expect(
				await refusalOf(moves.move("pc", "GH_TOKEN", { to: "personal" })),
			).toBe(NOT_YOUR_OTHER_DEVICE);
		} finally {
			detach();
		}
	});

	test("a secret on the Home Host computer moves there, for its owner only", async () => {
		// The Host is Ann's computer too: her Mac lists it among her other devices.
		const studio = await laptop();
		const { host } = homeHost(studio.store);
		expect(
			await refusalOf(
				macThrough(host.client(keyOf("pc", "bob"))).move("studio", "GH_TOKEN", {
					to: "personal",
				}),
			),
		).toBe(NOT_YOUR_OTHER_DEVICE);
		expect(studio.keychain.values.get("GH_TOKEN")).toBe("ghp_laptop");
		await macThrough(host.client(keyOf("mac", "ann"))).move(
			"studio",
			"GH_TOKEN",
			{ to: "personal" },
		);
		expect(studio.personal.kept.get("GH_TOKEN")).toBe("ghp_laptop");
		expect(studio.keychain.values.has("GH_TOKEN")).toBe(false);
		expect(studio.names()).toEqual([]);
	});
});
