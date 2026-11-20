import { describe, expect, test } from "bun:test";
import { inMemoryMembersPorts } from "../adapters/out/in-memory-neighbours";
import { listRoster } from "./list-roster";

describe("listRoster", () => {
	test("names each Member of the Space with their role", async () => {
		const ports = inMemoryMembersPorts();
		await ports.seed.person({ id: "ada", name: "Ada", email: "a@x.org" });
		await ports.seed.space({ id: "platform", name: "Platform" });
		await ports.seed.membership({
			id: "m-ada",
			spaceId: "platform",
			personId: "ada",
			role: "viewer",
			createdAt: 1,
		});
		expect(await listRoster(ports)({ spaceId: "platform" })).toEqual([
			{ id: "ada", name: "Ada", role: "viewer" },
		]);
		expect(await listRoster(ports)({ spaceId: "other" })).toEqual([]);
	});
});
