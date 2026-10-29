import { describe, expect, test } from "bun:test";
import type { SettingsStore } from "@nightshift/engine/device-config";
import { localHarnesses } from "./harnesses";

/**
 * A custom agent whose env names a secret that is not saved: the step
 * shows the daemon's words for the person, not a failure's plain words.
 */

describe("a custom agent", () => {
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
				"Goose needs the secret GOOSE_KEY, but it is not saved. Save it under Agents → Secrets, or remove the reference.",
		});
	});
});
