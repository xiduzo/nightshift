import { describe, expect, test } from "bun:test";
import { formatLearnings } from "@nightshift/flows";
import { inMemoryLearningsPorts } from "../adapters/out/in-memory-neighbours";
import { proposeLearnings } from "./propose-learnings";

/** The use case proposeLearnings, on in-memory adapters. Twin of "propose" in `learnings.test.ts`. */

const FILE = "learnings/proposed/run-1.s1.md";

describe("proposeLearnings", () => {
	test("writes Night Shift's header once, then adds what the step reports later", async () => {
		const ports = inMemoryLearningsPorts();
		const propose = proposeLearnings(ports);
		const step = { runId: "run-1", stepId: "s1" };
		await propose({ projectId: "p1", step, notes: ["Run make first."] });
		await propose({ projectId: "p1", step, notes: ["Use the staging key."] });
		expect(ports.folder.read("p1", FILE)).toBe(
			formatLearnings(["Run make first."], { runId: "run-1", isNew: true }) +
				formatLearnings(["Use the staging key."], {
					runId: "run-1",
					isNew: false,
				}),
		);
	});

	test("writes nothing without a note", async () => {
		const ports = inMemoryLearningsPorts();
		await proposeLearnings(ports)({
			projectId: "p1",
			step: { runId: "run-1", stepId: "s1" },
			notes: ["  "],
		});
		expect(ports.folder.files.size).toBe(0);
	});

	test("the look back at a run writes to the run's own file", async () => {
		const ports = inMemoryLearningsPorts();
		await proposeLearnings(ports)({
			projectId: "p1",
			step: { runId: "run-1" },
			notes: ["Ask before a release."],
			by: "run",
		});
		expect(ports.folder.read("p1", "learnings/proposed/run-1.md")).toContain(
			"- Ask before a release.",
		);
	});
});
