import { describe, expect, test } from "bun:test";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deviceKeyStore } from "../peers/host-links";
import { secretStore } from "./connections";
import { fileValues } from "./keychain";

const dir = () => mkdtempSync(join(tmpdir(), "nightshift-keychain-"));

describe("values without a keychain", () => {
	test("a file per value, readable by this user only", async () => {
		const root = dir();
		const store = fileValues(join(root, "secrets"));
		expect(await store.get("GITHUB_TOKEN")).toBeNull();
		await store.set("GITHUB_TOKEN", "ghp_secret");
		expect(await store.get("GITHUB_TOKEN")).toBe("ghp_secret");
		expect(statSync(join(root, "secrets")).mode & 0o777).toBe(0o700);
		expect(statSync(join(root, "secrets", "GITHUB_TOKEN")).mode & 0o777).toBe(
			0o600,
		);
		await store.delete("GITHUB_TOKEN");
		expect(await store.get("GITHUB_TOKEN")).toBeNull();
	});

	test("a name never leaves the folder", async () => {
		const root = dir();
		const store = fileValues(join(root, "keys"));
		await store.set("../escape", "value");
		expect(await store.get("../escape")).toBe("value");
		expect(statSync(join(root, "keys", ".._escape")).isFile()).toBe(true);
	});

	test("secrets and Device keys keep apart, each in the data directory", async () => {
		const dataDir = dir();
		const secrets = await secretStore({ dataDir, prefer: "file" });
		const keys = await deviceKeyStore({ dataDir, prefer: "file" });
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
