import { describe, expect, test } from "bun:test";
import { inMemorySpacesPorts } from "../adapters/out/in-memory-neighbours";
import { listSpaces } from "./list-spaces";

describe("listSpaces", () => {
	test("lists the personal Space first", async () => {
		const ports = inMemorySpacesPorts();
		const { records } = ports.spaceStore;
		records.spaces.push(
			{ id: "shared", name: "Platform", slug: "platform", personal: false },
			{ id: "mine", name: "Personal", slug: "personal-ada", personal: true },
		);
		records.members.push(
			{ spaceId: "shared", personId: "ada", role: "member" },
			{ spaceId: "mine", personId: "ada", role: "owner" },
		);
		expect(await listSpaces(ports)({ personId: "ada" })).toEqual([
			{ id: "mine", name: "Personal", personal: true, role: "owner" },
			{ id: "shared", name: "Platform", personal: false, role: "member" },
		]);
	});
});
