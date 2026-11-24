import { describe, expect, test } from "bun:test";
import { reviewPorts } from "../test-support";
import { readKnowledgeUse } from "./read-knowledge-use";

/** The use case readKnowledgeUse, over a database in memory. */

const DAY = 24 * 60 * 60 * 1000;

describe("readKnowledgeUse", () => {
	test("how often runs read each file in 90 days, and the listed files no run used lately", async () => {
		const ports = await reviewPorts();
		const now = 200 * DAY;
		ports.setNow(now);
		await ports.sync.publish("p1", "used.md", "Used.");
		await ports.sync.publish("p1", "idle.md", "Idle.");
		await ports.logUse("p1", {
			type: "KnowledgeRead",
			at: now - DAY,
			runId: "run-1",
			stepId: "s",
			payload: { path: "used.md", found: true },
		});
		const { files, use } = await readKnowledgeUse(ports)({ projectId: "p1" });
		expect(files.map((file) => file.path)).toEqual(["idle.md", "used.md"]);
		expect(use).toEqual({
			since: now - 90 * DAY,
			unusedDays: 30,
			runsUsedIt: true,
			files: [
				{
					path: "used.md",
					found: 0,
					read: 1,
					lastAt: now - DAY,
					lastRunAt: now - DAY,
				},
			],
			unused: ["idle.md"],
		});
		expect(ports.reads).toEqual([
			{ projectId: "p1", limit: 20_000, since: now - 90 * DAY },
		]);
	});
});
