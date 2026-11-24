import { describe, expect, test } from "bun:test";
import { Refusal } from "@nightshift/refusal";
import { callerOf } from "../adapters/out/in-memory-neighbours";
import { projectsPorts } from "../test-support";
import { listKeptSpaceSecrets } from "./list-kept-space-secrets";

describe("listKeptSpaceSecrets", () => {
	test("Members list the names; others are refused", async () => {
		const p = await projectsPorts();
		await p.spaceStore.set("space-1", "A_TOKEN", "value-a", "person-gone");
		expect(
			await listKeptSpaceSecrets(p)(callerOf(p.members), {
				spaceId: "space-1",
			}),
		).toEqual([
			{
				name: "A_TOKEN",
				setAt: 7,
				setBy: { id: "person-gone", name: "Someone" },
			},
		]);
		await expect(
			listKeptSpaceSecrets(p)(callerOf(p.members, "person-eve"), {
				spaceId: "space-1",
			}),
		).rejects.toBeInstanceOf(Refusal);
	});

	test("a Host that keeps no such Space refuses", async () => {
		const p = await projectsPorts();
		p.spaces.hosts.set("space-1", "host-2");
		await expect(
			listKeptSpaceSecrets(p)(callerOf(p.members), { spaceId: "space-1" }),
		).rejects.toThrow(
			"This computer does not keep that Space. Check that you work in the right Space.",
		);
	});
});
