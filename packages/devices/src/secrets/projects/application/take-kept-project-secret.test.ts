import { describe, expect, test } from "bun:test";
import {
	callerOf,
	inMemoryProjectsPorts,
} from "../adapters/out/in-memory-neighbours";
import { takeKeptProjectSecret } from "./take-kept-project-secret";

const at = { spaceId: "space-1", projectId: "project-1" };

describe("takeKeptProjectSecret", () => {
	test("a Member who saves Flows may; a viewer is refused in the role's words", async () => {
		const p = inMemoryProjectsPorts();
		p.members.join("person-bob", "space-1", "viewer");
		await p.store.set(at, "A_TOKEN", "value-a", "person-bob");
		let who = "person-bob";
		await expect(
			takeKeptProjectSecret(p)(callerOf(p.members, who), {
				...at,
				name: "A_TOKEN",
			}),
		).rejects.toThrow("Your role in this Space does not allow this.");
		expect(await p.store.values("project-1")).toEqual({ A_TOKEN: "value-a" });
		who = "person-ada";
		const answer = await takeKeptProjectSecret(p)(callerOf(p.members, who), {
			...at,
			name: "A_TOKEN",
		});
		expect(answer).toBe("value-a");
	});

	test("refuses a Project of a Space another Host keeps", async () => {
		const p = inMemoryProjectsPorts();
		p.spaces.hosts.set("space-1", "host-2");
		const who = "person-ada";
		await expect(
			takeKeptProjectSecret(p)(callerOf(p.members, who), {
				...at,
				name: "A_TOKEN",
			}),
		).rejects.toThrow(
			"This computer does not keep that project. Check that the project is in this Space.",
		);
	});
});
