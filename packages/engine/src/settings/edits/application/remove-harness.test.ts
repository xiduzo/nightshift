import { describe, expect, test } from "bun:test";
import type { AgentProfile } from "@nightshift/flows";
import { NIGHT_SHIFT } from "../../../contract";
import {
	inMemoryEditedProfiles,
	inMemoryEditedSettings,
} from "../adapters/out/in-memory-neighbours";
import { removeHarness } from "./remove-harness";

function profile(over: Partial<AgentProfile> = {}): AgentProfile {
	return {
		name: "fast",
		harness: "claude-code",
		model: "sonnet",
		permissionMode: "acceptEdits",
		clis: [],
		connections: [],
		...over,
	} as AgentProfile;
}

const labels = { gemini: "Gemini CLI" } as Parameters<
	typeof removeHarness
>[0]["labels"];

describe("removeHarness", () => {
	test("refuses to remove a harness a profile runs on, then removes it", async () => {
		const settings = inMemoryEditedSettings({ harnesses: ["gemini"] });
		const profiles = inMemoryEditedProfiles();
		const remove = removeHarness({ settings, profiles, labels });
		await profiles.save(profile({ harness: "gemini" }));
		await expect(remove(NIGHT_SHIFT, { harness: "gemini" })).rejects.toThrow(
			"The profile fast run on Gemini CLI. Move it to another harness first.",
		);
		const empty = removeHarness({
			settings,
			profiles: inMemoryEditedProfiles(),
			labels,
		});
		await empty(NIGHT_SHIFT, { harness: "gemini" });
		expect(settings.current().harnesses).toEqual([]);
	});

	test("removes a custom agent for good", async () => {
		const settings = inMemoryEditedSettings({
			customAgents: [
				{ slug: "goose", label: "Goose", command: "goose", args: [], env: {} },
			],
		});
		await removeHarness({
			settings,
			profiles: inMemoryEditedProfiles(),
			labels,
		})(NIGHT_SHIFT, { harness: "acp:goose" });
		expect(settings.current().customAgents).toEqual([]);
	});
});
