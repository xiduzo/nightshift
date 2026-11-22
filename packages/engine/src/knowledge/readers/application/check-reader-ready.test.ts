import { describe, expect, test } from "bun:test";
import type { PageReaderSetting } from "@nightshift/flows";
import { inMemoryReaderSettings } from "../adapters/out/in-memory-neighbours";
import { checkReaderReady } from "./check-reader-ready";

/** The use case checkReaderReady, on in-memory adapters. The twins of "whether the reader is ready" in `readers.test.ts`. */

async function ready(
	setting: PageReaderSetting,
	saved: Record<string, string> = {},
): Promise<boolean> {
	const settings = inMemoryReaderSettings();
	await settings.choose("p1", setting);
	return checkReaderReady({ settings, secret: async (name) => saved[name] })({
		projectId: "p1",
	});
}

describe("checkReaderReady", () => {
	test("Night Shift's own reader needs no key", async () => {
		expect(await ready({ kind: "nightshift" })).toBe(true);
		expect(
			await checkReaderReady({ settings: inMemoryReaderSettings() })({
				projectId: "p1",
			}),
		).toBe(true);
	});

	test("a service reader is ready when its secret is saved: the default name, or the one the setting names", async () => {
		expect(await ready({ kind: "firecrawl" })).toBe(false);
		expect(
			await ready({ kind: "firecrawl" }, { FIRECRAWL_API_KEY: "fc-1" }),
		).toBe(true);
		expect(
			await ready(
				{ kind: "jina", secret: "TEAM_JINA" },
				{ JINA_API_KEY: "j-1" },
			),
		).toBe(false);
		expect(
			await ready({ kind: "jina", secret: "TEAM_JINA" }, { TEAM_JINA: "j-2" }),
		).toBe(true);
	});

	test("a secret that cannot be read counts as not saved; without secrets no service is ready", async () => {
		const settings = inMemoryReaderSettings();
		await settings.choose("p1", { kind: "jina" });
		const locked = checkReaderReady({
			settings,
			secret: async () => {
				throw new Error("locked");
			},
		});
		expect(await locked({ projectId: "p1" })).toBe(false);
		expect(await checkReaderReady({ settings })({ projectId: "p1" })).toBe(
			false,
		);
	});
});
