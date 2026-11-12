import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { device, member, organization, user } from "@nightshift/db/schema";
import { createSandbox, type Sandbox } from "@nightshift/engine/testing";
import { asDate, now } from "@nightshift/time";
import { eq } from "drizzle-orm";
import { usageFacts } from "./usage-facts";

/**
 * The counts of the daily usage event, over a migrated database: the agents
 * whose program is here, a phone, a pairing, the Spaces and their people.
 */

let sandbox: Sandbox;
let ownerId: string;
beforeEach(async () => {
	sandbox = await createSandbox();
	const [self] = await sandbox.db
		.select({ ownerId: device.ownerId })
		.from(device)
		.where(eq(device.self, true));
	ownerId = self?.ownerId as string;
});
afterEach(async () => {
	await sandbox.cleanup();
});

/** A second Space, with the owner and Carol in it. */
async function teamSpace(): Promise<void> {
	const at = asDate(now());
	await sandbox.db
		.insert(user)
		.values({ id: "person-carol", name: "Carol", email: "carol@example.com" });
	await sandbox.db
		.insert(organization)
		.values({ id: "space-team", name: "Team", slug: "team", createdAt: at });
	await sandbox.db.insert(member).values([
		{
			id: "m-owner",
			organizationId: "space-team",
			userId: ownerId,
			role: "owner",
			createdAt: at,
		},
		{
			id: "m-carol",
			organizationId: "space-team",
			userId: "person-carol",
			role: "member",
			createdAt: at,
		},
	]);
}

describe("the counts of the daily usage event", () => {
	test("the agents found here, a phone, a pairing, and each Person once across the Spaces", async () => {
		await teamSpace();
		const asked: unknown[] = [];
		const facts = await usageFacts({
			db: sandbox.db,
			settings: {
				current: () => ({
					claudeBin: "claude",
					codexBin: "codex",
					opencodeBin: "opencode",
					customAgents: [{ command: "goose" }, { command: "gone" }],
				}),
			},
			listScreens: async (personId) => {
				asked.push(["screens", personId]);
				return [{ kind: "web-push" }, { kind: "expo" }];
			},
			devices: {
				overview: async (query) => {
					asked.push(["overview", query]);
					return { thisComputer: { hosts: [{}] } };
				},
			},
			ownerId,
			which: (program) =>
				["claude", "opencode", "goose"].includes(program)
					? `/usr/local/bin/${program}`
					: null,
		});
		expect(facts).toEqual({
			agents: 3,
			phone: true,
			paired: true,
			spaces: 2,
			members: 2,
		});
		expect(asked).toEqual([
			["screens", ownerId],
			["overview", { personId: ownerId, owner: true }],
		]);
	});

	test("no agent found, no phone, not paired: the owner's own Space only", async () => {
		const facts = await usageFacts({
			db: sandbox.db,
			settings: {
				current: () => ({ claudeBin: "claude", customAgents: [] }),
			},
			listScreens: async () => [{ kind: "web-push" }],
			devices: { overview: async () => ({ thisComputer: null }) },
			ownerId,
			which: () => null,
		});
		expect(facts).toEqual({
			agents: 0,
			phone: false,
			paired: false,
			spaces: 1,
			members: 1,
		});
	});
});
