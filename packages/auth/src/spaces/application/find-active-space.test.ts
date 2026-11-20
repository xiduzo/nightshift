import { describe, expect, test } from "bun:test";
import { inMemorySpacesPorts } from "../adapters/out/in-memory-neighbours";
import { findActiveSpace } from "./find-active-space";

describe("findActiveSpace", () => {
	test("is the active Space while the Person is a member of it", async () => {
		const ports = inMemorySpacesPorts();
		ports.spaceStore.records.members.push({
			spaceId: "platform",
			personId: "ada",
			role: "member",
		});
		expect(
			await findActiveSpace(ports)({
				personId: "ada",
				activeSpaceId: "platform",
			}),
		).toBe("platform");
		expect(ports.ensured).toEqual([]);
	});

	test("else, or without one, the personal Space", async () => {
		const ports = inMemorySpacesPorts();
		const find = findActiveSpace(ports);
		expect(await find({ personId: "ada", activeSpaceId: "left" })).toBe(
			"personal-of-ada",
		);
		expect(await find({ personId: "ada", activeSpaceId: null })).toBe(
			"personal-of-ada",
		);
		expect(ports.ensured).toEqual(["ada", "ada"]);
	});
});
