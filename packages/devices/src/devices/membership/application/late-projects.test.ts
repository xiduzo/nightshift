import { describe, expect, test } from "bun:test";
import { inMemoryHome, moving } from "../adapters/out/in-memory-home";
import { movedLate } from "../domain/words";
import { mergeSteps } from "./merge-steps";

/** The Projects a done merge left, on in-memory adapters. */

function setUp() {
	const { deps, world } = inMemoryHome();
	return { world, steps: mergeSteps(deps) };
}

describe("a Project that a done merge left", () => {
	test("one that stayed goes later only while this computer has the Host's Personal", async () => {
		const { world, steps } = setUp();
		await steps.start({});
		world.projects.push(moving("late"));
		const stays = async () => {
			await steps.moveLate();
			expect(world.projects.at(-1)?.spaceId).toBe("own");
			expect(world.databaseCopy.copies).toHaveLength(1);
		};
		world.personalSpaces.setPersonalId("fresh");
		await stays();
		world.personalSpaces.setPersonalId("theirs");
		world.keptBy.set("own", "another");
		await stays();
		world.keptBy.delete("own");
		world.online.delete("host");
		await stays();
		world.online.add("host");
		world.run("r", { projectId: "late", status: "waiting" });
		await stays();
		world.runs = [];

		await steps.moveLate();
		expect(world.projects.at(-1)?.spaceId).toBe("theirs");
		expect(world.databaseCopy.copies.at(-1)).toBe(
			"/tmp/before-late-projects.db",
		);
		expect([...world.notes]).toEqual([["late", [movedLate("Studio")]]]);
		// Nothing is left: no copy and no ask.
		const asks = world.asked.length;
		await steps.moveLate();
		expect(world.asked).toHaveLength(asks);
		expect(world.databaseCopy.copies).toHaveLength(2);
	});

	test("a batch that failed is not tried again in this process, and the next one tries", async () => {
		const { deps, world } = inMemoryHome();
		const steps = mergeSteps(deps);
		await steps.start({});
		world.projects.push(moving("late"));
		world.batchFails = new Error("disk full");
		await expect(steps.moveLate()).rejects.toThrow("disk full");
		await steps.moveLate();
		expect(world.databaseCopy.copies).toHaveLength(2);
		expect(world.record.mergesRows[0]?.state).toBe("pushed");
		expect(world.notes.size).toBe(0);

		world.batchFails = null;
		await mergeSteps(deps).moveLate();
		expect(world.projects.at(-1)?.spaceId).toBe("theirs");
	});

	test("a stop behind the batch goes on to the same end, and says it once", async () => {
		const { deps, world } = inMemoryHome();
		const steps = mergeSteps(deps);
		await steps.start({});
		world.projects.push(moving("late"));
		world.pushed = false;
		await steps.moveLate();
		const row = await world.record.merges.latest();
		expect(row).toMatchObject({
			state: "moved",
			late: ["late"],
			backup: "/tmp/before-personal-merge.db",
		});
		world.pushed = true;
		if (row) await mergeSteps(deps).resume(row);
		expect(world.record.mergesRows[0]?.state).toBe("pushed");
		expect(world.notes.get("late")).toHaveLength(1);
	});
});
