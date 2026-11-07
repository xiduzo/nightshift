import { describe, expect, test } from "bun:test";
import type { ProfileView } from "@nightshift/engine/device-config";
import { Refusal } from "@nightshift/refusal";

import { accessAs, testContext } from "../testing";
import { agentChoices } from "./agent-choices";

const PROFILES: Record<string, ProfileView> = {
	builder: {
		name: "builder",
		harness: "codex",
		model: "gpt-5",
		permissionMode: "auto",
		clis: [],
		connections: [],
		id: "builder",
		updatedAt: 0,
	},
	triage: { name: "triage", decider: "ollama", id: "triage", updatedAt: 0 },
};

/** A request of `personId` on the computer Ada owns, with its two profiles. */
function contextOf(personId: string) {
	return testContext({
		access: accessAs({ personId, spaceId: "space", role: "owner" }),
		daemon: {
			device: { id: "mac", name: "Mac", ownerId: "ada" },
		} as never,
		profiles: { get: (id: string) => PROFILES[id] ?? null },
	});
}

const sonnet = { harness: "claude-code", model: "sonnet" } as const;

describe("the agents a person chooses for an import", () => {
	test("each choice names the profile on this computer", () => {
		expect(
			agentChoices(contextOf("ada"), [{ ...sonnet, profile: "builder" }]),
		).toEqual([
			{ agent: sonnet, profile: { device: "mac", profile: "builder" } },
		]);
	});

	test("no choice is no change, for anyone", () => {
		expect(agentChoices(contextOf("bo"), undefined)).toEqual([]);
		expect(agentChoices(contextOf("bo"), [])).toEqual([]);
	});

	test("only the owner of this computer chooses its profiles", () => {
		expect(() =>
			agentChoices(contextOf("bo"), [{ ...sonnet, profile: "builder" }]),
		).toThrow(Refusal);
	});

	test("refuses a profile this computer does not have, or a Model Profile", () => {
		for (const profile of ["gone", "triage"]) {
			expect(() =>
				agentChoices(contextOf("ada"), [{ ...sonnet, profile }]),
			).toThrow("Choose your agents again.");
		}
	});
});
