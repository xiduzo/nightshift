import { describe, expect, test } from "bun:test";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { secretStore } from "@nightshift/engine";
import { deviceKeyStore } from "./host-links";

const dir = () => mkdtempSync(join(tmpdir(), "nightshift-keychain-"));

describe("Device keys without a keychain", () => {
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
