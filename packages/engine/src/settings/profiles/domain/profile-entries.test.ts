import { describe, expect, test } from "bun:test";
import type { ProfileSettings } from "@nightshift/flows";
import {
	profileChoice,
	profileIdOf,
	profilesInOrder,
	readProfiles,
	settingsFor,
} from "./profile-entries";

const settings: ProfileSettings = {
	harness: "claude-code",
	model: "sonnet",
	permissionMode: "acceptEdits",
	clis: [],
	connections: [],
};

describe("profile entries", () => {
	test("a new id is the random value after p-", () => {
		expect(profileIdOf("abc")).toBe("p-abc");
	});

	test("the list is by name, then by id", () => {
		const profiles = readProfiles([
			["p-2", { name: "b", description: null, settings, updatedAt: 1 }],
			["p-3", { name: "a", description: null, settings, updatedAt: 1 }],
			["p-1", { name: "b", description: null, settings, updatedAt: 1 }],
		]);
		expect(profilesInOrder(profiles).map((p) => p.id)).toEqual([
			"p-3",
			"p-1",
			"p-2",
		]);
	});

	test("a run finds a profile by its id, never by its name", () => {
		const profiles = readProfiles([
			["p-1", { name: "night", description: "x", settings, updatedAt: 1 }],
		]);
		expect(settingsFor(profiles, "p-1")).toEqual(settings);
		expect(settingsFor(profiles, "night")).toBeNull();
	});

	test("a Person picks an Agent Profile with its permission mode", () => {
		const [view] = readProfiles([
			["p-1", { name: "night", description: null, settings, updatedAt: 1 }],
		]).values();
		expect(view && profileChoice(view)).toEqual({
			id: "p-1",
			name: "night",
			kind: "agent",
			permissionMode: "acceptEdits",
		});
	});
});
