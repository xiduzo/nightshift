import { describe, expect, test } from "bun:test";
import type { Profile } from "@nightshift/flows";
import { inMemorySavedProfiles } from "../adapters/out/in-memory-saved-profiles";
import { writeProfile } from "./write-profile";

const night: Profile = {
	name: "night",
	harness: "claude-code",
	model: "sonnet",
	permissionMode: "acceptEdits",
	clis: [],
	connections: [],
};

function writing() {
	const saved = inMemorySavedProfiles();
	const write = writeProfile({ saved, now: () => 1000, random: () => "r1" });
	return { saved, write };
}

describe("writeProfile", () => {
	test("a new profile gets an id from the random value, with a hyphen", async () => {
		const { saved, write } = writing();
		const view = await write({ profile: night });
		expect(view.id).toBe("p-r1");
		expect(saved.read().get("p-r1")?.name).toBe("night");
	});

	test("a rename keeps the id and answers the profile as saved", async () => {
		const { saved, write } = writing();
		await write({ profile: night, id: "p-1" });
		const view = await write({ profile: { ...night, name: "day" }, id: "p-1" });
		expect(view).toEqual({ ...night, name: "day", id: "p-1", updatedAt: 1000 });
		expect([...saved.read().keys()]).toEqual(["p-1"]);
	});

	test("an empty description is saved as none", async () => {
		const { saved, write } = writing();
		await write({ profile: { ...night, description: "" }, id: "p-1" });
		expect(saved.writes[0]?.entry?.description).toBeNull();
	});

	test("a profile that does not parse writes nothing", async () => {
		const { saved, write } = writing();
		await expect(
			write({ profile: { ...night, name: "has space" } }),
		).rejects.toThrow();
		expect(saved.writes).toEqual([]);
	});
});
