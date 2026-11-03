import { describe, expect, test } from "bun:test";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { secretStore } from "@nightshift/engine/device-config";
import {
	type DeviceKeyStore,
	deviceKeyStore,
	deviceKeysOf,
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
