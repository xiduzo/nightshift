import { describe, expect, test } from "bun:test";
import { inMemoryProjectsPorts } from "../adapters/out/in-memory-neighbours";
import { listSpaceSecrets } from "./list-space-secrets";

describe("listSpaceSecrets", () => {
	test("in a Space this computer keeps, its own store, after the same checks", async () => {
		const p = inMemoryProjectsPorts();
		await p.spaceStore.set("space-1", "A_TOKEN", "value-a", "person-ada");
		const who = "person-ada";
		const answer = await listSpaceSecrets(p)({
			spaceId: "space-1",
			personId: who,
		});
		expect(answer).toEqual([
			{ name: "A_TOKEN", setAt: 7, setBy: { id: "person-ada", name: "Ada" } },
		]);
		expect(p.calls.asked).toEqual([]);
	});

	test("here, a Person who is no Member is refused", async () => {
		const p = inMemoryProjectsPorts();
		const who = "person-eve";
		await expect(
			listSpaceSecrets(p)({ spaceId: "space-1", personId: who }),
		).rejects.toThrow(
			"This device takes no part in that Space. Ask an owner of the Space to invite you.",
		);
	});

	test("in a Space a Host keeps, each call goes there with this Device's key, as its owner only", async () => {
		const p = inMemoryProjectsPorts();
		p.spaces.hosts.set("space-1", "host-1");
		const sent: unknown[] = [];
		p.calls.addHost("host-1", {
			spaceSecrets: {
				list: async (input: unknown) => {
					sent.push(input);
					return [];
				},
			},
		});
		let who = "person-ada";
		await listSpaceSecrets(p)({ spaceId: "space-1", personId: who });
		expect(sent).toHaveLength(1);
		expect(p.calls.asked).toEqual([
			{
				hostId: "host-1",
				deadlineMs: 20_000,
				olderHost:
					"The Host of this Space runs an older version of Night Shift. Update Night Shift there to use project secrets.",
			},
		]);
		who = "person-bob";
		await expect(
			listSpaceSecrets(p)({ spaceId: "space-1", personId: who }),
		).rejects.toThrow(
			"Only the owner of this computer can change this project's secrets here.",
		);
		expect(sent).toHaveLength(1);
	});
});
