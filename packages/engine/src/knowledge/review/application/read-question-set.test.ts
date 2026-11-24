import { describe, expect, test } from "bun:test";
import { inMemoryReviewPorts } from "../adapters/out/in-memory-neighbours";
import { formatQuestions } from "../domain/questions";
import { readQuestionSet } from "./read-question-set";

/** The use case readQuestionSet, on in-memory adapters. */

describe("readQuestionSet", () => {
	test("reads the set's file under a hold", async () => {
		const ports = inMemoryReviewPorts();
		const set = [
			{
				query: "rollback",
				answers: ["ops/rollback.md"],
				markedAt: 5,
				by: null,
			},
		];
		const read = readQuestionSet(ports);
		ports.questions.read = async () => {
			ports.sync.holds.push("read");
			return formatQuestions(set);
		};
		expect(await read({ projectId: "p1" })).toEqual(set);
		expect(ports.sync.holds).toEqual(["hold p1", "read", "done p1"]);
	});

	test("no file, or one that is not valid, is an empty set", async () => {
		const ports = inMemoryReviewPorts();
		const read = readQuestionSet(ports);
		expect(await read({ projectId: "p1" })).toEqual([]);
		ports.questions.files.set("p1", "{ not json");
		expect(await read({ projectId: "p1" })).toEqual([]);
		expect(ports.sync.holds).toEqual([
			"hold p1",
			"done p1",
			"hold p1",
			"done p1",
		]);
	});

	test("ends the hold when the read fails", async () => {
		const ports = inMemoryReviewPorts();
		const failure = new Error("disk");
		ports.questions.read = async () => {
			throw failure;
		};
		const error = await readQuestionSet(ports)({ projectId: "p1" }).catch(
			(caught: unknown) => caught,
		);
		expect(error).toBe(failure);
		expect(ports.sync.holds).toEqual(["hold p1", "done p1"]);
	});
});
