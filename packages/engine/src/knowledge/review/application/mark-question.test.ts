import { describe, expect, test } from "bun:test";
import { inMemoryReviewPorts } from "../adapters/out/in-memory-neighbours";
import { parseQuestions } from "../domain/questions";
import { markQuestion } from "./mark-question";

/** The use case markQuestion, on in-memory adapters. */

describe("markQuestion", () => {
	test("marks the files an agent reads under a hold, newest first, and with none takes the question out", async () => {
		const ports = inMemoryReviewPorts();
		const mark = markQuestion(ports);
		ports.setNow(5);
		expect(
			await mark({
				projectId: "p1",
				query: " rollback ",
				answers: ["ops/rollback.md", "INDEX.md"],
				by: "ada",
			}),
		).toEqual([
			{
				query: "rollback",
				answers: ["ops/rollback.md"],
				markedAt: 5,
				by: "ada",
			},
		]);
		expect(
			parseQuestions(ports.questions.files.get("p1") ?? null),
		).toHaveLength(1);
		expect(
			await mark({ projectId: "p1", query: "Rollback", answers: [], by: null }),
		).toEqual([]);
		expect(ports.holds.events).toEqual([
			"hold p1",
			"done p1",
			"hold p1",
			"done p1",
		]);
	});

	test("ends the hold when the write fails", async () => {
		const ports = inMemoryReviewPorts();
		const failure = new Error("disk");
		ports.questions.write = async () => {
			throw failure;
		};
		const error = await markQuestion(ports)({
			projectId: "p1",
			query: "q",
			answers: ["a.md"],
			by: null,
		}).catch((caught: unknown) => caught);
		expect(error).toBe(failure);
		expect(ports.holds.events).toEqual(["hold p1", "done p1"]);
	});
});
