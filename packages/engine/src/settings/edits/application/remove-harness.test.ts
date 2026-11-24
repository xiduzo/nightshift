import { describe, expect, test } from "bun:test";
import type { AgentProfile } from "@nightshift/flows";
import {
	inMemoryComputer,
	ONLY_THE_OWNER,
} from "../../../access/computer/adapters/out/in-memory-computer";
import { NIGHT_SHIFT } from "../../../contract";
import { inMemoryProfiles } from "../../profiles/adapters/out/in-memory-profiles";
import { inMemorySettings } from "../../settings/adapters/out/in-memory-settings";
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
		const settings = inMemorySettings({ harnesses: ["gemini"] });
		const profiles = inMemoryProfiles();
		const remove = removeHarness({
			computerAccess: inMemoryComputer(),
			settings,
			profiles,
			labels,
		});
		await profiles.save(profile({ harness: "gemini" }));
		await expect(remove(NIGHT_SHIFT, { harness: "gemini" })).rejects.toThrow(
			"The profile fast run on Gemini CLI. Move it to another harness first.",
		);
		const empty = removeHarness({
			computerAccess: inMemoryComputer(),
			settings,
			profiles: inMemoryProfiles(),
			labels,
		});
		await empty(NIGHT_SHIFT, { harness: "gemini" });
		expect(settings.current().harnesses).toEqual([]);
	});

	test("removes a custom agent for good", async () => {
		const settings = inMemorySettings({
			customAgents: [
				{
					slug: "goose",
					label: "Goose",
					command: "goose",
					args: [],
					env: {},
				},
			],
		});
		await removeHarness({
			computerAccess: inMemoryComputer(),
			settings,
			profiles: inMemoryProfiles(),
			labels,
		})(NIGHT_SHIFT, { harness: "acp:goose" });
		expect(settings.current().customAgents).toEqual([]);
	});
});

test("only the owner of this computer may, and nothing happens before the check", async () => {
	const computerAccess = inMemoryComputer();
	// The other ports are not there: a use of one before the check fails.
	const act = removeHarness({ computerAccess } as never);
	expect(
		await computerAccess.whoMay((actor) => act(actor, {} as never)),
	).toEqual(ONLY_THE_OWNER);
});
