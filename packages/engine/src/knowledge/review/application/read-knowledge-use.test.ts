import { describe, expect, test } from "bun:test";
import { inMemoryReviewPorts } from "../adapters/out/in-memory-neighbours";
import { readKnowledgeUse } from "./read-knowledge-use";

/** The use case readKnowledgeUse, on in-memory adapters. */

const DAY = 24 * 60 * 60 * 1000;

describe("readKnowledgeUse", () => {
	test("how often runs read each file in 90 days, and the listed files no run used lately", async () => {
		const ports = inMemoryReviewPorts();
		const now = 200 * DAY;
		ports.setNow(now);
		ports.files.listed.set("p1", [
			{ path: "used.md", size: 1, changedAt: 1 },
			{ path: "idle.md", size: 1, changedAt: 1 },
		]);
		ports.log.log("p1", {
			type: "KnowledgeRead",
			at: now - DAY,
			runId: "run-1",
			stepId: "s",
			payload: { path: "used.md", found: true },
		});
		const { files, use } = await readKnowledgeUse(ports)({ projectId: "p1" });
		expect(files.map((file) => file.path)).toEqual(["used.md", "idle.md"]);
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
		expect(ports.log.reads).toEqual([
			{ projectId: "p1", limit: 20_000, since: now - 90 * DAY },
		]);
	});
});
