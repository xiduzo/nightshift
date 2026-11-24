import { describe, expect, test } from "bun:test";
import { callerOf } from "../adapters/out/in-memory-neighbours";
import { projectsPorts } from "../test-support";
import { takeKeptSpaceSecret } from "./take-kept-space-secret";

describe("takeKeptSpaceSecret", () => {
	test("a Member who saves Flows may; a viewer is refused", async () => {
		const p = await projectsPorts();
		p.members.join("person-bob", "space-1", "viewer");
		await p.spaceStore.set("space-1", "A_TOKEN", "value-a", "person-bob");
		await expect(
			takeKeptSpaceSecret(p)(callerOf(p.members, "person-bob"), {
				spaceId: "space-1",
				name: "A_TOKEN",
			}),
		).rejects.toThrow("Your role in this Space does not allow this.");
		const answer = await takeKeptSpaceSecret(p)(callerOf(p.members), {
			spaceId: "space-1",
			name: "A_TOKEN",
		});
		expect(answer).toBe("value-a");
	});

	test("a Host that keeps no such Space refuses", async () => {
		const p = await projectsPorts();
		p.spaces.hosts.set("space-1", "host-2");
		await expect(
			takeKeptSpaceSecret(p)(callerOf(p.members), {
				spaceId: "space-1",
				name: "A_TOKEN",
			}),
		).rejects.toThrow(
			"This computer does not keep that Space. Check that you work in the right Space.",
		);
	});
});
