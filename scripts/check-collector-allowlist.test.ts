/**
 * scripts/check-collector-allowlist.ts, on a small config and on this repository.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ATTR, REGISTRY, usageEventSchema } from "@nightshift/semconv";

import {
	allowlistProblems,
	checkCollectorAllowlist,
	eventNameFrom,
	resourceKeysFrom,
	usageExportKeys,
} from "./check-collector-allowlist";

const SEND = [
	"resourceFromAttributes({",
	"  [ATTR.serviceName]: name,",
	"  [ATTR.hostArch]: arch,",
	"})",
	"processors:",
	'const EVENT_NAME = "event.name";',
	"",
].join("\n");

function yamlWith(keys: readonly string[], allowAll = false): string {
	return [
		"processors:",
		"  redaction:",
		`    allow_all_keys: ${allowAll}`,
		"    allowed_keys:",
		...keys.map((key) => `      - ${key}`),
		"",
	].join("\n");
}

describe("the usage export", () => {
	test("reads the resource attributes and the event name from the sender", () => {
		expect(resourceKeysFrom(SEND).sort()).toEqual(
			[ATTR.hostArch, ATTR.serviceName].sort(),
		);
		expect(eventNameFrom(SEND)).toBe("event.name");
	});

	test("includes every usage-event attribute", () => {
		const keys = usageExportKeys(SEND);
		for (const schema of Object.values(usageEventSchema)) {
			for (const key of Object.keys(schema.shape)) {
				if (key !== "name") expect(keys).toContain(key);
			}
		}
		expect(keys).toContain(ATTR.serviceName);
		expect(keys).toContain("event.name");
	});
});

describe("the Collector allowlist", () => {
	test("passes when the list is the usage export", () => {
		const keys = usageExportKeys(SEND);
		expect(allowlistProblems(yamlWith(keys), SEND)).toEqual([]);
	});

	test("fails a key the registry does not define", () => {
		const keys = [...usageExportKeys(SEND), "not-a-registry-key"];
		expect(allowlistProblems(yamlWith(keys), SEND)).toEqual([
			"collector.yaml allows not-a-registry-key. The registry does not define that key.",
		]);
	});

	test("fails a registry key the usage export does not send", () => {
		const extra = Object.keys(REGISTRY.attributes).find(
			(key) => !usageExportKeys(SEND).includes(key),
		);
		expect(extra).toBeString();
		const keys = [...usageExportKeys(SEND), extra as string];
		expect(allowlistProblems(yamlWith(keys), SEND)).toEqual([
			`collector.yaml allows ${extra}. The usage export does not send that key.`,
		]);
	});

	test("fails a missing usage key", () => {
		const keys = usageExportKeys(SEND).slice(1);
		const missing = usageExportKeys(SEND)[0];
		expect(allowlistProblems(yamlWith(keys), SEND)).toEqual([
			`collector.yaml misses ${missing}. The usage export sends that key.`,
		]);
	});

	test("fails when allow_all_keys is on", () => {
		const keys = usageExportKeys(SEND);
		expect(allowlistProblems(yamlWith(keys, true), SEND)).toContain(
			"collector.yaml must set allow_all_keys to false.",
		);
	});
});

describe("the command", () => {
	test("the real sender names the resource attributes", () => {
		const root = join(import.meta.dir, "..");
		const source = readFileSync(
			join(root, "packages/telemetry/src/usage/send.ts"),
			"utf8",
		);
		const keys = usageExportKeys(source);
		expect(keys).toContain(ATTR.serviceName);
		expect(keys).toContain(ATTR.serviceVersion);
		expect(keys).toContain(ATTR.osType);
		expect(keys).toContain(ATTR.hostArch);
		expect(keys).toContain(ATTR.serviceInstance);
		expect(keys).toContain("event.name");
	});

	test("it passes on this repository", () => {
		const root = join(import.meta.dir, "..");
		expect(checkCollectorAllowlist(root)).toEqual([]);
	});
});
