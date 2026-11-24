import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { DeviceKeyAccess } from "@nightshift/auth";
import type { PersonalSecrets, ProjectSecrets } from "@nightshift/engine";
import {
	createConnectionStore,
	createSandbox,
	type Sandbox,
} from "@nightshift/engine/testing";
import { messageOf, Refusal } from "@nightshift/refusal";
import {
	type HostClient,
	type WorkReply,
	type WorkRequest,
	workRequestSchema,
} from "../contract";
import type { PairedDevice } from "../devices/registry";
import type { HostExchange } from "../exchange";
import type { HostLink } from "../links";
import { admitEvery, partialHostClient } from "../testing";
import { linksTo } from "../testing/host-in-memory";
import { inMemoryHost } from "../testing/in-memory-host";
import { createWorkHub, createWorkServer, type WorkHub } from "../work";
import type { OwnSecrets } from "./moves";
import {
	NOT_HOME_FOR_MOVES,
	NOT_YOUR_OTHER_DEVICE,
	ONLY_FOR_OWNER,
	ONLY_FROM_HOME,
} from "./moves/domain/secret-moves";
import { secretsOf } from "./test-support";
import { wireSecrets } from "./wire";

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
	const { serve } = wireSecrets({
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
	return secretsOf({
		db: sandbox.db,
		hostLinks: { home: async () => linkTo(HOST) },
		links: () => linksTo(new Map([[HOST, client]])),
		ownerId: "local-ann",
	}).ofDevices.moves;
}

/** The Home Host, with its hub and its router in memory. It is Ann's, and keeps secrets of its own (`own`). */
function homeHost(own?: OwnSecrets) {
	const hub = createWorkHub();
	const host = inMemoryHost({
		exchange: {} as HostExchange,
		hello: () => Promise.reject(new Error("No hello in this test.")),
		// The Host admits each key's Device as its registry has it.
		admit: admitEvery((key) => {
			const device = DEVICES.find((d) => d.id === key.deviceId);
			return device
				? { device: { name: device.name, homeHost: device.homeHost } }
				: {};
		}),
		secretMoves: secretsOf({
			db: sandbox.db,
			devices: registry,
			work: hub,
			selfId: "studio",
			ownerId: "ann",
			own,
		}).ofDevices.secretMoves,
	});
	return { hub, host };
}

async function refusalOf(promise: Promise<unknown>): Promise<string> {
	try {
		await promise;
	} catch (error) {
		return messageOf(error);
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

	test("only the owner asks: a Device of another Person, or a guest Device", async () => {
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
