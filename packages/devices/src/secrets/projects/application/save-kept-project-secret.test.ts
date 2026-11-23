import { describe, expect, test } from "bun:test";
import {
	callerOf,
	inMemoryProjectsPorts,
} from "../adapters/out/in-memory-neighbours";
import { saveKeptProjectSecret } from "./save-kept-project-secret";

const at = { spaceId: "space-1", projectId: "project-1" };

describe("saveKeptProjectSecret", () => {
	test("a Member who saves Flows may; a viewer is refused in the role's words", async () => {
		const p = inMemoryProjectsPorts();
		p.members.join("person-bob", "space-1", "viewer");
		await p.store.set(at, "A_TOKEN", "value-a", "person-bob");
		let who = "person-bob";
		await expect(
			saveKeptProjectSecret(p)(callerOf(p.members, who), {
				...at,
				name: "A_TOKEN",
				value: "value-new",
			}),
		).rejects.toThrow("Your role in this Space does not allow this.");
		expect(await p.store.values("project-1")).toEqual({ A_TOKEN: "value-a" });
		who = "person-ada";
		const answer = await saveKeptProjectSecret(p)(callerOf(p.members, who), {
			...at,
			name: "A_TOKEN",
			value: "value-new",
		});
		expect(answer).toBeUndefined();
		expect(await p.store.values("project-1")).toEqual({ A_TOKEN: "value-new" });
		expect((await p.store.list("project-1"))[0]?.setBy).toBe("person-ada");
	});

	test("refuses a Project of a Space another Host keeps", async () => {
		const p = inMemoryProjectsPorts();
		p.spaces.hosts.set("space-1", "host-2");
		const who = "person-ada";
		await expect(
			saveKeptProjectSecret(p)(callerOf(p.members, who), {
				...at,
				name: "A_TOKEN",
				value: "value-new",
			}),
		).rejects.toThrow(
			"This computer does not keep that project. Check that the project is in this Space.",
		);
	});
});
