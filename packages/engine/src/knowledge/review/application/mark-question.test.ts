import { describe, expect, test } from "bun:test";
import { allowing } from "../../../access/adapters/out/in-memory-access";
import { NIGHT_SHIFT } from "../../../contract";
import { parseQuestions } from "../domain/questions";
import { reviewPorts } from "../test-support";
import { markQuestion } from "./mark-question";

/** The use case markQuestion, over a database in memory. */

describe("markQuestion", () => {
	test("marks the files an agent reads under a hold, newest first, and with none takes the question out", async () => {
		const ports = await reviewPorts();
		const mark = markQuestion(ports);
		ports.setNow(5);
		expect(
			await mark(NIGHT_SHIFT, {
				spaceId: "space-1",
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
			await mark(NIGHT_SHIFT, {
				spaceId: "space-1",
				projectId: "p1",
				query: "Rollback",
				answers: [],
				by: null,
			}),
		).toEqual([]);
		expect(ports.sync.holds).toEqual([
			"hold p1",
			"done p1",
			"hold p1",
			"done p1",
		]);
	});

	test("ends the hold when the write fails", async () => {
		const ports = await reviewPorts();
		const failure = new Error("disk");
		ports.questions.write = async () => {
			throw failure;
		};
		const error = await markQuestion(ports)(NIGHT_SHIFT, {
			spaceId: "space-1",
			projectId: "p1",
			query: "q",
			answers: ["a.md"],
			by: null,
		}).catch((caught: unknown) => caught);
		expect(error).toBe(failure);
		expect(ports.sync.holds).toEqual(["hold p1", "done p1"]);
	});

	test("owners, admins and members may, and nobody else", async () => {
		const ports = await reviewPorts();
		expect(
			await ports.access.whoMay(
				"space-1",
				(actor) =>
					markQuestion(ports)(actor, {
						spaceId: "space-1",
						projectId: "p1",
						query: "q",
						answers: ["a.md"],
						by: null,
					}),
				() => ports.sync.holds,
			),
		).toEqual(allowing("owner", "admin", "member"));
	});
});
