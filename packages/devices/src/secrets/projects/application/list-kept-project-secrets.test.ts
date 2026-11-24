import { describe, expect, test } from "bun:test";
import { Refusal } from "@nightshift/refusal";
import { callerOf } from "../adapters/out/in-memory-neighbours";
import { projectsPorts } from "../test-support";
import { listKeptProjectSecrets } from "./list-kept-project-secrets";

const at = { spaceId: "space-1", projectId: "project-1" };

describe("listKeptProjectSecrets", () => {
	test("Members list the names with who and when, never a value", async () => {
		const p = await projectsPorts();
		p.members.join("person-bob", "space-1", "viewer");
		await p.store.set(at, "A_TOKEN", "value-a", "person-ada");
		expect(
			await listKeptProjectSecrets(p)(callerOf(p.members, "person-bob"), at),
		).toEqual([
			{ name: "A_TOKEN", setAt: 7, setBy: { id: "person-ada", name: "Ada" } },
		]);
	});

	test("refuses a Person who is no Member, and a Project of another Space", async () => {
		const p = await projectsPorts();
		await expect(
			listKeptProjectSecrets(p)(callerOf(p.members, "person-eve"), at),
		).rejects.toThrow(
			"This device takes no part in that Space. Ask an owner of the Space to invite you.",
		);
		await expect(
			listKeptProjectSecrets(p)(callerOf(p.members), {
				spaceId: "space-2",
				projectId: "project-1",
			}),
		).rejects.toBeInstanceOf(Refusal);
	});

	test("refuses a Project of a Space another Host keeps", async () => {
		const p = await projectsPorts();
		p.spaces.hosts.set("space-1", "host-2");
		await expect(
			listKeptProjectSecrets(p)(callerOf(p.members), at),
		).rejects.toThrow(
			"This computer does not keep that project. Check that the project is in this Space.",
		);
	});
});
