import { describe, expect, test } from "bun:test";
import {
	callerOf,
	inMemoryProjectsPorts,
} from "../adapters/out/in-memory-neighbours";
import { removeKeptSpaceSecret } from "./remove-kept-space-secret";

describe("removeKeptSpaceSecret", () => {
	test("a Member who saves Flows may; a viewer is refused", async () => {
		const p = inMemoryProjectsPorts();
		p.members.join("person-bob", "space-1", "viewer");
		await p.spaceStore.set("space-1", "A_TOKEN", "value-a", "person-bob");
		await expect(
			removeKeptSpaceSecret(p)(callerOf(p.members, "person-bob"), {
				spaceId: "space-1",
				name: "A_TOKEN",
			}),
		).rejects.toThrow("Your role in this Space does not allow this.");
		const answer = await removeKeptSpaceSecret(p)(callerOf(p.members), {
			spaceId: "space-1",
			name: "A_TOKEN",
		});
		expect(answer).toBeUndefined();
		expect(await p.spaceStore.values("space-1")).toEqual({});
	});

	test("a Host that keeps no such Space refuses", async () => {
		const p = inMemoryProjectsPorts();
		p.spaces.hosts.set("space-1", "host-2");
		await expect(
			removeKeptSpaceSecret(p)(callerOf(p.members), {
				spaceId: "space-1",
				name: "A_TOKEN",
			}),
		).rejects.toThrow(
			"This computer does not keep that Space. Check that you work in the right Space.",
		);
	});
});
