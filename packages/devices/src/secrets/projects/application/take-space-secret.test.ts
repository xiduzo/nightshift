import { describe, expect, test } from "bun:test";
import { projectsPorts } from "../test-support";
import { takeSpaceSecret } from "./take-space-secret";

describe("takeSpaceSecret", () => {
	test("in a Space this computer keeps, its own store, after the same checks", async () => {
		const p = await projectsPorts();
		await p.spaceStore.set("space-1", "A_TOKEN", "value-a", "person-ada");
		const who = "person-ada";
		const answer = await takeSpaceSecret(p)({
			spaceId: "space-1",
			name: "A_TOKEN",
			personId: who,
		});
		expect(answer).toBe("value-a");
		expect(p.calls.asked).toEqual([]);
	});

	test("a Host's answer that is no value is refused", async () => {
		const p = await projectsPorts();
		p.spaces.hosts.set("space-1", "host-1");
		p.calls.addHost("host-1", {
			spaceSecrets: { take: async () => ({ value: "x" }) },
		});
		await expect(
			takeSpaceSecret(p)({
				spaceId: "space-1",
				name: "A_TOKEN",
				personId: "person-ada",
			}),
		).rejects.toThrow("an answer that this computer cannot read");
	});

	test("here, a viewer is refused in the role's words", async () => {
		const p = await projectsPorts();
		p.members.join("person-bob", "space-1", "viewer");
		const who = "person-bob";
		await expect(
			takeSpaceSecret(p)({
				spaceId: "space-1",
				name: "A_TOKEN",
				personId: who,
			}),
		).rejects.toThrow("Your role in this Space does not allow this.");
	});

	test("in a Space a Host keeps, each call goes there with this Device's key, as its owner only", async () => {
		const p = await projectsPorts();
		p.spaces.hosts.set("space-1", "host-1");
		const sent: unknown[] = [];
		p.calls.addHost("host-1", {
			spaceSecrets: {
				take: async (input: unknown) => {
					sent.push(input);
					return null;
				},
			},
		});
		let who = "person-ada";
		await takeSpaceSecret(p)({
			spaceId: "space-1",
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
			takeSpaceSecret(p)({
				spaceId: "space-1",
				name: "A_TOKEN",
				personId: who,
			}),
		).rejects.toThrow(
			"Only the owner of this computer can change this project's secrets here.",
		);
		expect(sent).toHaveLength(1);
	});
});
