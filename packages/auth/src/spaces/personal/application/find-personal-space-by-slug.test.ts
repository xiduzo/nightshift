import { describe, expect, test } from "bun:test";
import { inMemoryPersonalPorts } from "../adapters/out/in-memory-neighbours";
import { findPersonalSpaceBySlug } from "./find-personal-space-by-slug";

describe("findPersonalSpaceBySlug", () => {
	test("finds the Space of the Person's slug, without a membership", async () => {
		const ports = inMemoryPersonalPorts();
		ports.records.spaces.push({
			id: "theirs",
			name: "Personal",
			slug: "personal-ada",
			personal: true,
		});
		const find = findPersonalSpaceBySlug(ports);
		expect(await find({ personId: "ada" })).toBe("theirs");
		expect(await find({ personId: "bo" })).toBeNull();
	});
});
