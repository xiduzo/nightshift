import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { valueStore } from "@nightshift/engine/device-config";
import {
	createConnectionStore,
	createSandbox,
	createSettingsStore,
	type Sandbox,
} from "@nightshift/engine/testing";

import { moveTelemetryHeaders } from "./headers-move";

/**
 * Headers kept the old way, in `<dataDir>/telemetry`, move into the
 * setting and the Secrets page at start: the export goes on as before.
 */

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await sandbox.cleanup();
});

async function stores() {
	const document = await sandbox.openDocument();
	const kept = new Map<string, string>();
	const settings = createSettingsStore({ document, env: {} });
	const secrets = createConnectionStore({
		document,
		env: {},
		secrets: {
			get: async (name) => kept.get(name) ?? null,
			set: async (name, value) => {
				kept.set(name, value);
			},
			delete: async (name) => {
				kept.delete(name);
			},
		},
	});
	const move = () =>
		moveTelemetryHeaders({
			dataDir: sandbox.dataDir,
			keyStore: { prefer: "file" },
			settings,
			secrets,
		});
	return { settings, secrets, kept, move };
}

/** The old store, as an older Night Shift wrote it. */
async function keptTheOldWay(headers: Record<string, string>) {
	const old = await valueStore({
		service: "nightshift-telemetry",
		dir: join(sandbox.dataDir, "telemetry"),
		prefer: "file",
	});
	await old.set("otlp-headers", JSON.stringify(headers));
}

describe("moveTelemetryHeaders", () => {
	test("each value becomes a secret, the setting references it, and the old store is empty", async () => {
		const h = await stores();
		await h.settings.save({ telemetryHeaders: { "X-Kept": "as written" } });
		await keptTheOldWay({
			Authorization: "Bearer glc-abc",
			"X-Scope-OrgID": "night",
		});

		expect((await h.move()).sort()).toEqual(["Authorization", "X-Scope-OrgID"]);

		expect(h.settings.current().telemetryHeaders).toEqual({
			"X-Kept": "as written",
			Authorization: "${OTEL_HEADER_AUTHORIZATION}",
			"X-Scope-OrgID": "${OTEL_HEADER_X_SCOPE_ORGID}",
		});
		expect(Object.fromEntries(h.kept)).toEqual({
			OTEL_HEADER_AUTHORIZATION: "Bearer glc-abc",
			OTEL_HEADER_X_SCOPE_ORGID: "night",
		});
		// The secrets are on the Secrets page, and the export reads them.
		expect(h.secrets.secrets().map((s) => s.name)).toEqual([
			"OTEL_HEADER_AUTHORIZATION",
			"OTEL_HEADER_X_SCOPE_ORGID",
		]);
		const expanded = await h.secrets.expandEnv(
			h.settings.current().telemetryHeaders,
		);
		expect(expanded.ok && expanded.env).toEqual({
			"X-Kept": "as written",
			Authorization: "Bearer glc-abc",
			"X-Scope-OrgID": "night",
		});
		expect(await readdir(join(sandbox.dataDir, "telemetry"))).toEqual([]);
		// A second start finds nothing to move.
		expect(await h.move()).toEqual([]);
	});

	test("a secret of that name with another value is kept: the header gets a new name", async () => {
		const h = await stores();
		await h.secrets.setSecret("OTEL_HEADER_AUTHORIZATION", "someone else's");
		await keptTheOldWay({ Authorization: "Bearer mine" });

		await h.move();

		expect(h.settings.current().telemetryHeaders).toEqual({
			Authorization: "${OTEL_HEADER_AUTHORIZATION_2}",
		});
		expect(h.kept.get("OTEL_HEADER_AUTHORIZATION")).toBe("someone else's");
		expect(h.kept.get("OTEL_HEADER_AUTHORIZATION_2")).toBe("Bearer mine");
	});

	test("with nothing kept the old way, nothing changes", async () => {
		const h = await stores();
		expect(await h.move()).toEqual([]);
		expect(h.settings.current().telemetryHeaders).toEqual({});
		expect(h.kept.size).toBe(0);
	});
});
