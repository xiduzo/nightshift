import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { ORPCError } from "@orpc/client";
import type { HostClient } from "../contract";
import {
	type DeviceKeyStore,
	deviceKeysOf,
	type HostLink,
	type HostLinks,
} from "./host-links";
import { createDeviceLinks } from "./links";

/** CONVERSION, with an end (`KeyNaming`): this file goes with it. */

/** A keychain in memory, with a write or a read that a test holds or fails. */
function keychain(entries: Record<string, string>) {
	const values = new Map(Object.entries(entries));
	const writes: string[] = [];
	const twin = {
		values,
		writes,
		holdWrite: null as Promise<void> | null,
		failWrite: false,
		failReads: 0,
		store: {
			kind: "keychain",
			async get(name) {
				if (twin.failReads > 0) {
					twin.failReads--;
					throw new Error(`no access to ${name}`);
				}
				return values.get(name) ?? null;
			},
			async set(name, value) {
				writes.push(name);
				await twin.holdWrite;
				if (twin.failWrite) throw new Error(`no access to ${name} ${value}`);
				values.set(name, value);
			},
			async delete(name) {
				values.delete(name);
			},
		} satisfies DeviceKeyStore as DeviceKeyStore,
		now: () => Object.fromEntries(values),
	};
	return twin;
}

const link = (hostId: string, more: Partial<HostLink> = {}): HostLink =>
	({
		hostId,
		name: hostId,
		addresses: ["https://studio.invalid"],
		certificate: null,
		fingerprint: null,
		role: "home",
		personId: "person",
		keyStore: "keychain",
		createdAt: 0,
		revokedAt: null,
		...more,
	}) as HostLink;

const logs = mock((..._: unknown[]) => {});
const errors = mock((..._: unknown[]) => {});
const said = { log: console.log, error: console.error };
let close: (() => Promise<void>)[] = [];
beforeEach(() => {
	console.log = logs;
	console.error = errors;
});
afterEach(async () => {
	await Promise.all(close.map((end) => end()));
	close = [];
	Object.assign(console, said);
	logs.mockClear();
	errors.mockClear();
});
const lines = (spy: typeof logs) =>
	spy.mock.calls.map((call) => call.join(" "));

/** Starts the links of one install. The Host answers with `answer`. */
async function start(
	keys: DeviceKeyStore,
	options: {
		hosts?: HostLink[];
		deviceId?: string;
		localOnly?: boolean;
		answer?: () => string;
	} = {},
) {
	const revoked: string[] = [];
	const links = createDeviceLinks({
		links: {
			list: async () => options.hosts ?? [link("host")],
			setAddresses: async () => {},
			revoked: async (hostId: string) => {
				revoked.push(hostId);
			},
		} as unknown as HostLinks,
		keys,
		...("deviceId" in options
			? options.deviceId
				? { deviceId: options.deviceId }
				: {}
			: { deviceId: "desktop" }),
		localOnly: options.localOnly,
		hostClient: () => {
			const hello = async () => ({
				deviceId: (options.answer ?? (() => "desktop"))(),
				host: { addresses: [] },
			});
			return { link: { hello, heartbeat: hello } } as unknown as HostClient;
		},
		linkOptions: { heartbeatMs: 5, firstBackoffMs: 5, maxBackoffMs: 5 },
	});
	close.push(() => links.close());
	await links.start();
	return { links, revoked };
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 30));
const status = (
	links: Awaited<ReturnType<typeof start>>["links"],
	id = "host",
) => links.get(id)?.state().status;

describe("a key under the Host's id alone", () => {
	test("is also kept under the Device's own name once the Host accepts it", async () => {
		const chain = keychain({ host: "nsd_1" });
		const { links } = await start(deviceKeysOf(chain.store, "desktop"));
		await settled();
		expect(status(links)).toBe("online");
		expect(chain.now()).toEqual({ host: "nsd_1", "desktop/host": "nsd_1" });
		expect(chain.writes).toEqual(["desktop/host"]);
		expect(lines(logs)).toEqual([
			"Device keys: 0 under their own name, 1 under the Host's name alone.",
			"Device key: 1 kept under its own name.",
		]);
		expect(errors).not.toHaveBeenCalled();
	});

	test("the next start finds it under its own name and writes nothing", async () => {
		const chain = keychain({ host: "nsd_1", "desktop/host": "nsd_1" });
		await start(deviceKeysOf(chain.store, "desktop"));
		await settled();
		expect(chain.writes).toEqual([]);
		expect(lines(logs)).toEqual([
			"Device keys: 1 under their own name, 0 under the Host's name alone.",
		]);
	});

	test("the key under the own name wins and is never replaced", async () => {
		const chain = keychain({ host: "nsd_1", "desktop/host": "nsd_2" });
		const keys = deviceKeysOf(chain.store, "desktop");
		expect(await keys.naming?.keepOwn("host", "nsd_1")).toBe(false);
		expect(chain.now()).toEqual({ host: "nsd_1", "desktop/host": "nsd_2" });
	});

	test("a key that is not the one in the store now is not written", async () => {
		const chain = keychain({});
		const keys = deviceKeysOf(chain.store, "desktop");
		expect(await keys.naming?.keepOwn("host", "nsd_1")).toBe(false);
		expect(chain.writes).toEqual([]);
	});

	test("stays as it is when the Host knows it as another Device's", async () => {
		const chain = keychain({ host: "nsd_dev" });
		const { links } = await start(deviceKeysOf(chain.store, "desktop"), {
			answer: () => "dev",
		});
		await settled();
		expect(status(links)).toBe("revoked");
		expect(chain.now()).toEqual({ host: "nsd_dev" });
		expect(chain.writes).toEqual([]);
	});

	test("stays as it is when this computer cannot compare the Device", async () => {
		const chain = keychain({ host: "nsd_1" });
		const { links } = await start(deviceKeysOf(chain.store, "desktop"), {
			deviceId: undefined,
		});
		await settled();
		expect(status(links)).toBe("online");
		expect(chain.writes).toEqual([]);
	});

	test("is not written while the Host is offline, and is when it is back", async () => {
		const chain = keychain({ host: "nsd_1" });
		let offline = true;
		await start(deviceKeysOf(chain.store, "desktop"), {
			answer: () => {
				if (offline) throw new Error("offline");
				return "desktop";
			},
		});
		await settled();
		expect(chain.writes).toEqual([]);
		offline = false;
		await settled();
		expect(chain.now()).toEqual({ host: "nsd_1", "desktop/host": "nsd_1" });
	});

	test("is never written when the Host refuses it", async () => {
		const chain = keychain({ host: "nsd_1" });
		const { revoked } = await start(deviceKeysOf(chain.store, "desktop"), {
			answer: () => {
				throw new ORPCError("UNAUTHORIZED");
			},
		});
		await settled();
		expect(revoked).toEqual(["host"]);
		expect(chain.writes).toEqual([]);
		// The refused key goes, as before.
		expect(chain.now()).toEqual({});
	});

	test("two installs: only the one the Host knows it as keeps it", async () => {
		const chain = keychain({ host: "nsd_dev" });
		for (const deviceId of ["desktop", "dev"]) {
			await start(deviceKeysOf(chain.store, deviceId), {
				deviceId,
				answer: () => "dev",
			});
			await settled();
		}
		expect(chain.now()).toEqual({ host: "nsd_dev", "dev/host": "nsd_dev" });
	});

	test("two Hosts: each key is kept under its own Host", async () => {
		const chain = keychain({ a: "nsd_a", b: "nsd_b" });
		await start(deviceKeysOf(chain.store, "desktop"), {
			hosts: [link("a"), link("b", { role: "guest" })],
		});
		await settled();
		expect(chain.now()).toEqual({
			a: "nsd_a",
			b: "nsd_b",
			"desktop/a": "nsd_a",
			"desktop/b": "nsd_b",
		});
		expect(lines(logs)[0]).toBe(
			"Device keys: 0 under their own name, 2 under the Host's name alone.",
		);
	});

	test("the count leaves out each Host this computer does not connect to", async () => {
		const chain = keychain({ a: "nsd_a", b: "nsd_b" });
		const warn = console.warn;
		console.warn = () => {};
		try {
			await start(deviceKeysOf(chain.store, "desktop"), {
				hosts: [
					link("a"),
					link("b", { revokedAt: 1, addresses: ["http://127.0.0.1:1"] }),
				],
				localOnly: true,
			});
		} finally {
			console.warn = warn;
		}
		expect(logs).not.toHaveBeenCalled();
	});
});

describe("a keychain that does not answer well", () => {
	test("a write that fails leaves the link online, is said once, and runs again at the next start", async () => {
		const chain = keychain({ host: "nsd_1" });
		chain.failWrite = true;
		let drop = false;
		const { links } = await start(deviceKeysOf(chain.store, "desktop"), {
			answer: () => {
				if (drop) {
					drop = false;
					throw new Error("offline");
				}
				return "desktop";
			},
		});
		await settled();
		drop = true;
		await settled();
		expect(status(links)).toBe("online");
		expect(chain.writes).toEqual(["desktop/host"]);
		expect(lines(errors)).toEqual([
			"Device key: 1 not kept under its own name. The next start tries again.",
		]);
		chain.failWrite = false;
		await start(deviceKeysOf(chain.store, "desktop"));
		await settled();
		expect(chain.now()).toEqual({ host: "nsd_1", "desktop/host": "nsd_1" });
	});

	test("a write that never ends does not hold the link", async () => {
		const chain = keychain({ host: "nsd_1" });
		chain.holdWrite = new Promise(() => {});
		const { links } = await start(deviceKeysOf(chain.store, "desktop"));
		await settled();
		expect(status(links)).toBe("online");
	});

	test("names that cannot be read do not stop the start", async () => {
		const chain = keychain({ host: "nsd_1" });
		chain.failReads = 1;
		const { links } = await start(deviceKeysOf(chain.store, "desktop"));
		await settled();
		expect(status(links)).toBe("online");
		expect(lines(errors)).toEqual(["Device keys: their names were not read."]);
	});
});

describe("a join or a leave around the write", () => {
	test("a join that comes while it runs is the last to write", async () => {
		const chain = keychain({ host: "nsd_1" });
		const held = Promise.withResolvers<void>();
		chain.holdWrite = held.promise;
		const keys = deviceKeysOf(chain.store, "desktop");
		const kept = keys.naming?.keepOwn("host", "nsd_1");
		const joined = keys.set("host", "nsd_2");
		await settled();
		expect(chain.writes).toEqual(["desktop/host"]);
		chain.holdWrite = null;
		held.resolve();
		await Promise.all([kept, joined]);
		expect(chain.now()).toEqual({ host: "nsd_1", "desktop/host": "nsd_2" });
	});

	test("a leave that comes while it runs takes both names", async () => {
		const chain = keychain({ host: "nsd_1" });
		const held = Promise.withResolvers<void>();
		chain.holdWrite = held.promise;
		const keys = deviceKeysOf(chain.store, "desktop");
		const kept = keys.naming?.keepOwn("host", "nsd_1");
		const left = keys.delete("host");
		held.resolve();
		await Promise.all([kept, left]);
		expect(chain.now()).toEqual({});
	});

	test("a leave after a write that failed still deletes the key", async () => {
		const chain = keychain({ host: "nsd_1" });
		chain.failWrite = true;
		const keys = deviceKeysOf(chain.store, "desktop");
		await keys.naming?.keepOwn("host", "nsd_1").catch(() => {});
		await keys.delete("host");
		expect(chain.now()).toEqual({});
	});

	test("it does not start after a join or a leave of that Host", async () => {
		for (const change of ["set", "delete"] as const) {
			const chain = keychain({ host: "nsd_1", "desktop/host": "nsd_2" });
			const keys = deviceKeysOf(chain.store, "desktop");
			await (change === "set"
				? keys.set("host", "nsd_3")
				: keys.delete("host"));
			chain.values.delete("desktop/host");
			expect(await keys.naming?.keepOwn("host", "nsd_1")).toBe(false);
			expect(chain.now()).toEqual({ host: "nsd_1" });
		}
	});

	test("a delete of its own key only leaves the one under the Host's id", async () => {
		const chain = keychain({ host: "nsd_1", "desktop/host": "nsd_1" });
		const keys = deviceKeysOf(chain.store, "desktop");
		await keys.delete("host", { ownOnly: true });
		expect(chain.now()).toEqual({ host: "nsd_1" });
	});

	test("a leave takes the kept key under both names, and no other install's", async () => {
		const chain = keychain({ host: "nsd_1", "desktop/host": "nsd_1" });
		await deviceKeysOf(chain.store, "dev").set("host", "nsd_dev");
		await deviceKeysOf(chain.store, "desktop").delete("host");
		expect(chain.now()).toEqual({ "dev/host": "nsd_dev" });
	});
});
