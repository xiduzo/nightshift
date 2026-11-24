import { describe, expect, test } from "bun:test";
import { projectsPorts } from "../test-support";
import { removeProjectSecret } from "./remove-project-secret";

const at = { spaceId: "space-1", projectId: "project-1" };

describe("removeProjectSecret", () => {
	test("in a Space this computer keeps, its own store, after the same checks", async () => {
		const p = await projectsPorts();
		await p.store.set(at, "A_TOKEN", "value-a", "person-ada");
		const who = "person-ada";
		const answer = await removeProjectSecret(p)({
			project: at,
			name: "A_TOKEN",
			personId: who,
		});
		expect(answer).toBeUndefined();
		expect(await p.store.values("project-1")).toEqual({});
		expect(p.calls.asked).toEqual([]);
	});

	test("here, a viewer is refused in the role's words", async () => {
		const p = await projectsPorts();
		p.members.join("person-bob", "space-1", "viewer");
		const who = "person-bob";
		await expect(
			removeProjectSecret(p)({ project: at, name: "A_TOKEN", personId: who }),
		).rejects.toThrow("Your role in this Space does not allow this.");
	});

	test("in a Space a Host keeps, each call goes there with this Device's key, as its owner only", async () => {
		const p = await projectsPorts();
		p.spaces.hosts.set("space-1", "host-1");
		const sent: unknown[] = [];
		p.calls.addHost("host-1", {
			projectSecrets: {
				remove: async (input: unknown) => {
					sent.push(input);
					return undefined;
				},
			},
		});
		let who = "person-ada";
		await removeProjectSecret(p)({
			project: at,
			name: "A_TOKEN",
			personId: who,
		});
		expect(sent).toHaveLength(1);
		expect(p.calls.asked).toEqual([
			{
				hostId: "host-1",
				deadlineMs: 20_000,
			},
		]);
		who = "person-bob";
		await expect(
			removeProjectSecret(p)({ project: at, name: "A_TOKEN", personId: who }),
		).rejects.toThrow(
			"Only the owner of this computer can change this project's secrets here.",
		);
		expect(sent).toHaveLength(1);
	});
});
