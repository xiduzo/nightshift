import { describe, expect, test } from "bun:test";
import type { SettingsStore } from "@nightshift/engine/device-config";
import { localHarnesses } from "./harnesses";

/**
 * A custom agent's env, with `${NAME}` expanded per session: a secret that
 * is not saved ends the session with the daemon's words for the person,
 * and every value it reads is one the session's output hides.
 */

const goose = {
	slug: "goose",
	label: "Goose",
	command: "goose-that-never-runs",
	args: ["acp"],
	// biome-ignore lint/suspicious/noTemplateCurlyInString: a secret reference, as a person writes it.
	env: { GOOSE_API_KEY: "${GOOSE_KEY}", GOOSE_MODE: "fast" },
};

describe("a custom agent", () => {
	test("hides every value its env reads, a saved secret or this computer's environment, and reads them once", async () => {
		let reads = 0;
		const harnesses = localHarnesses({
			settings: {
				current: () => ({ customAgents: [goose] }),
			} as unknown as Pick<SettingsStore, "current">,
			connections: {
				expandEnv: async () => {
					reads += 1;
					return {
						ok: true,
						env: { GOOSE_API_KEY: "from-the-environment", GOOSE_MODE: "fast" },
						values: ["from-the-environment"],
					};
				},
			},
		});
		const session = harnesses.customHarness?.("acp:goose");
		expect(await session?.secretValues?.()).toEqual(["from-the-environment"]);
		expect(await session?.secretValues?.()).toEqual(["from-the-environment"]);
		expect(reads).toBe(1);
	});

	test("whose env names a secret that is not saved ends its session with what to do", async () => {
		const settings = {
			current: () => ({
				customAgents: [
					{
						slug: "goose",
						label: "Goose",
						command: "goose-that-never-runs",
						args: ["acp"],
						// biome-ignore lint/suspicious/noTemplateCurlyInString: a secret reference, as a person writes it.
						env: { GOOSE_API_KEY: "${GOOSE_KEY}" },
					},
				],
			}),
		} as unknown as Pick<SettingsStore, "current">;
		const harnesses = localHarnesses({
			settings,
			connections: {
				expandEnv: async () => ({ ok: false, missing: ["GOOSE_KEY"] }),
			},
		});
		const goose = harnesses.customHarness?.("acp:goose");
		if (!goose) throw new Error("expected the custom agent");
		let last: unknown;
		for await (const event of goose.run({
			cwd: process.cwd(),
			prompt: "Hello",
			model: "default",
			permissionMode: "acceptEdits",
			signal: new AbortController().signal,
		})) {
			last = event;
		}
		expect(last).toMatchObject({
			type: "error",
			message:
				"Goose needs the secret GOOSE_KEY, but it is not saved. Save it on the Secrets page, or remove the reference.",
		});
	});
});
