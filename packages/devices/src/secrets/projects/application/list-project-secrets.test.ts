import { describe, expect, test } from "bun:test";
import { projectsPorts } from "../test-support";
import { listProjectSecrets } from "./list-project-secrets";

const at = { spaceId: "space-1", projectId: "project-1" };

describe("listProjectSecrets", () => {
	test("in a Space this computer keeps, its own store, after the same checks", async () => {
		const p = await projectsPorts();
		await p.store.set(at, "A_TOKEN", "value-a", "person-ada");
		const who = "person-ada";
		const answer = await listProjectSecrets(p)({ project: at, personId: who });
		expect(answer).toEqual([
			{ name: "A_TOKEN", setAt: 7, setBy: { id: "person-ada", name: "Ada" } },
		]);
		expect(p.calls.asked).toEqual([]);
	});

	test("here, a Person who is no Member is refused", async () => {
		const p = await projectsPorts();
		const who = "person-eve";
		await expect(
			listProjectSecrets(p)({ project: at, personId: who }),
		).rejects.toThrow(
			"This device takes no part in that Space. Ask an owner of the Space to invite you.",
		);
	});

	test("in a Space a Host keeps, each call goes there with this Device's key, as its owner only", async () => {
		const p = await projectsPorts();
		p.spaces.hosts.set("space-1", "host-1");
		const sent: unknown[] = [];
		p.calls.addHost("host-1", {
			projectSecrets: {
				list: async (input: unknown) => {
					sent.push(input);
					return [];
				},
			},
		});
		let who = "person-ada";
		await listProjectSecrets(p)({ project: at, personId: who });
		expect(sent).toHaveLength(1);
		expect(p.calls.asked).toEqual([
			{
				hostId: "host-1",
				deadlineMs: 20_000,
			},
		]);
		who = "person-bob";
		await expect(
			listProjectSecrets(p)({ project: at, personId: who }),
		).rejects.toThrow(
			"Only the owner of this computer can change this project's secrets here.",
		);
		expect(sent).toHaveLength(1);
	});
});
