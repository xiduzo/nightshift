import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { secretStore } from "@nightshift/engine";
import { createSandbox, type Sandbox } from "@nightshift/engine/testing";
import {
	createHostLinks,
	type DeviceKeyStore,
	deviceKeyStore,
	deviceKeysOf,
	SECOND_HOME,
} from "./host-links";

const dir = () => mkdtempSync(join(tmpdir(), "nightshift-keychain-"));

describe("Device keys without a keychain", () => {
	test("secrets and Device keys keep apart, each in the data directory", async () => {
		const dataDir = dir();
		const secrets = await secretStore({ dataDir, prefer: "file" });
		const keys = await deviceKeyStore({
			dataDir,
			deviceId: "d1",
			prefer: "file",
		});
		expect(secrets.kind).toBe("file");
		expect(keys.kind).toBe("file");
		await secrets.set("host-a", "a secret");
		await keys.set("host-a", "nsd_key");
		expect(await secrets.get("host-a")).toBe("a secret");
		expect(await keys.get("host-a")).toBe("nsd_key");
		expect(statSync(join(dataDir, "secrets", "host-a")).isFile()).toBe(true);
		expect(statSync(join(dataDir, "device-keys", "host-a")).isFile()).toBe(
			true,
		);
	});
});

/** A keychain in memory: one per user, so every install on the computer shares it. */
function sharedKeychain(): DeviceKeyStore & { names(): string[] } {
	const values = new Map<string, string>();
	return {
		kind: "keychain",
		get: async (name) => values.get(name) ?? null,
		set: async (name, value) => {
			values.set(name, value);
		},
		delete: async (name) => {
			values.delete(name);
		},
		names: () => [...values.keys()],
	};
}

describe("Device keys in a keychain two installs share", () => {
	test("a delete of its own key only never takes the one from before", async () => {
		const keychain = sharedKeychain();
		await keychain.set("host", "nsd_of_another_install");
		const keys = deviceKeysOf(keychain, "desktop");
		await keys.set("host", "nsd_own");
		await keys.delete("host", { ownOnly: true });
		await keys.delete("host", { ownOnly: true });
		expect(keychain.names()).toEqual(["host"]);
	});

	test("each Device keeps its own key for the same Host", async () => {
		const keychain = sharedKeychain();
		const desktop = deviceKeysOf(keychain, "desktop");
		const dev = deviceKeysOf(keychain, "dev");
		await dev.set("host", "nsd_dev");
		await desktop.set("host", "nsd_desktop");
		expect(await dev.get("host")).toBe("nsd_dev");
		expect(await desktop.get("host")).toBe("nsd_desktop");
		expect(keychain.names().sort()).toEqual(["desktop/host", "dev/host"]);
	});

	test("a key from before, under the Host alone, is read until the Device has its own", async () => {
		const keychain = sharedKeychain();
		await keychain.set("host", "nsd_before");
		const keys = deviceKeysOf(keychain, "desktop");
		expect(await keys.get("host")).toBe("nsd_before");
		await keys.set("host", "nsd_new");
		expect(await keys.get("host")).toBe("nsd_new");
		// Its own goes first; the one from before stays for its owner.
		await keys.delete("host");
		expect(await keychain.get("host")).toBe("nsd_before");
		await keys.delete("host");
		expect(await keys.get("host")).toBeNull();
	});
});

describe("the links of a joining Device", () => {
	let sandbox: Sandbox;
	beforeEach(async () => {
		sandbox = await createSandbox();
	});
	afterEach(() => sandbox.cleanup());

	const link = {
		hostId: "host-a",
		name: "studio",
		addresses: ["https://studio.local", "https://studio.example.com"],
		certificate: null,
		fingerprint: null,
		role: "home" as const,
		personId: "person-a",
		keyStore: "file" as const,
	};

	test("a home link is this Device's home Host; a second home is refused", async () => {
		const links = createHostLinks(sandbox.db);
		await links.save(link);
		expect((await links.home())?.hostId).toBe("host-a");

		await expect(
			links.save({ ...link, hostId: "host-c", name: "other" }),
		).rejects.toThrow(SECOND_HOME);
		await links.save({ ...link, hostId: "host-c", role: "guest" });
		expect((await links.list()).map((l) => [l.hostId, l.role])).toEqual([
			["host-c", "guest"],
			["host-a", "home"],
		]);
	});

	test("a revoked home can be replaced, and the Device has no home meanwhile", async () => {
		const links = createHostLinks(sandbox.db);
		await links.save(link);
		await links.revoked("host-a");
		expect((await links.get("host-a"))?.revokedAt).not.toBeNull();
		expect(await links.home()).toBeNull();

		await links.save({
			...link,
			hostId: "host-c",
			addresses: ["https://new.example.com"],
		});
		expect(await links.get("host-a")).toBeNull();
		expect((await links.home())?.addresses).toEqual([
			"https://new.example.com",
		]);
	});

	test("a key kept in a file is readable by its owner only", async () => {
		const store = await deviceKeyStore({
			dataDir: sandbox.dataDir,
			deviceId: sandbox.deviceId,
			prefer: "file",
		});
		expect(store.kind).toBe("file");
		expect(await store.get("host-a")).toBeNull();
		await store.set("host-a", "nsd_secret");
		expect(await store.get("host-a")).toBe("nsd_secret");
		const { mode } = statSync(join(sandbox.dataDir, "device-keys", "host-a"));
		expect(mode & 0o777).toBe(0o600);
		await store.delete("host-a");
		expect(await store.get("host-a")).toBeNull();
	});
});
