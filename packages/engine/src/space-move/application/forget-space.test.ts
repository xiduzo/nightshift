import { describe, expect, test } from "bun:test";
import { spaceMovePorts } from "../test-support";
import { forgetSpace } from "./forget-space";

/** The use case forgetSpace, over a database in memory. */

/** Space `gone`, its row removed, with two facts of no run, a fact of a run that is gone and an answer cost. */
async function emptied() {
	const ports = await spaceMovePorts();
	await ports.rows.event("gone", null);
	await ports.rows.event("gone", null);
	await ports.rows.event("gone", "moved-away");
	await ports.rows.event("kept", null);
	await ports.rows.answerCost("gone");
	await ports.rows.answerCost("kept");
	ports.entries.documents.set("gone", { projects: new Map(), clones: [] });
	return ports;
}

describe("forgetSpace", () => {
	test("once a move emptied it, its facts of no run, its answer costs and its document go; another Space keeps everything", async () => {
		const ports = await emptied();
		expect(await forgetSpace(ports)({ spaceId: "gone" })).toBe(true);
		expect(await ports.rows.events()).toEqual([
			{ spaceId: "kept", runId: null },
		]);
		expect(await ports.rows.answerCosts()).toEqual([{ spaceId: "kept" }]);
		expect(ports.entries.documents.has("gone")).toBe(false);
		expect(ports.entries.calls).toEqual(["forget gone"]);
	});

	test("is refused while the Space's own row is here: nothing goes", async () => {
		const ports = await emptied();
		await ports.rows.space("gone");
		expect(await forgetSpace(ports)({ spaceId: "gone" })).toBe(false);
		expect(await ports.rows.events()).toHaveLength(4);
		expect(ports.entries.calls).toEqual([]);
	});

	test("is refused while a Project or a run of it is here: nothing goes", async () => {
		const ports = await emptied();
		await ports.rows.project({ id: "other", spaceId: "kept" });
		await ports.rows.run({
			id: "r1",
			spaceId: "gone",
			projectId: "other",
			walkerId: "a",
		});
		expect(await forgetSpace(ports)({ spaceId: "gone" })).toBe(false);
		await ports.rows.clearRuns();
		await ports.rows.project({ id: "app", spaceId: "gone" });
		expect(await forgetSpace(ports)({ spaceId: "gone" })).toBe(false);
		expect(await ports.rows.answerCosts()).toHaveLength(2);
		expect(ports.entries.calls).toEqual([]);
	});
});
