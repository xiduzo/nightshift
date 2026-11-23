import { describe, expect, test } from "bun:test";
import {
	callerOf,
	inMemoryProjectsPorts,
} from "../adapters/out/in-memory-neighbours";
import { saveKeptSpaceSecret } from "./save-kept-space-secret";

describe("saveKeptSpaceSecret", () => {
	test("a Member who saves Flows may; a viewer is refused", async () => {
		const p = inMemoryProjectsPorts();
		p.members.join("person-bob", "space-1", "viewer");
		await p.spaceStore.set("space-1", "A_TOKEN", "value-a", "person-bob");
		await expect(
			saveKeptSpaceSecret(p)(callerOf(p.members, "person-bob"), {
				spaceId: "space-1",
				name: "A_TOKEN",
				value: "value-new",
			}),
		).rejects.toThrow("Your role in this Space does not allow this.");
		const answer = await saveKeptSpaceSecret(p)(callerOf(p.members), {
			spaceId: "space-1",
			name: "A_TOKEN",
			value: "value-new",
		});
		expect(answer).toBeUndefined();
		expect(await p.spaceStore.values("space-1")).toEqual({
			A_TOKEN: "value-new",
		});
	});

	test("a Host that keeps no such Space refuses", async () => {
		const p = inMemoryProjectsPorts();
		p.spaces.hosts.set("space-1", "host-2");
		await expect(
			saveKeptSpaceSecret(p)(callerOf(p.members), {
				spaceId: "space-1",
				name: "A_TOKEN",
				value: "value-new",
			}),
		).rejects.toThrow(
			"This computer does not keep that Space. Check that you work in the right Space.",
		);
	});
});
