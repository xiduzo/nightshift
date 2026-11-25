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

	test("keeps each question of the file it cannot read, as it is and in its place", async () => {
		const ports = await reviewPorts();
		const older = { query: "old", answer: "a.md" };
		const extra = {
			query: "kept",
			answers: ["b.md"],
			markedAt: 1,
			by: null,
			note: "x",
		};
		const write = (questions: unknown[]) =>
			ports.questions.files.set(
				"p1",
				JSON.stringify({ version: 1, questions, more: true }),
			);
		const stored = () => JSON.parse(ports.questions.files.get("p1") ?? "null");
		write([older, extra, "words"]);
		ports.setNow(5);
		const mark = (query: string, answers: string[]) =>
			markQuestion(ports)(NIGHT_SHIFT, {
				spaceId: "space-1",
				projectId: "p1",
				query,
				answers,
				by: null,
			});
		const next = await mark("new", ["c.md"]);
		expect(next.map(({ query }) => query)).toEqual(["new", "kept"]);
		expect(stored()).toEqual({
			version: 1,
			questions: [
				{ query: "new", answers: ["c.md"], markedAt: 5, by: null },
				older,
				extra,
				"words",
			],
			more: true,
		});
		await mark("kept", []);
		await mark("new", []);
		expect(stored().questions).toEqual([older, "words"]);
	});

	test("refuses to write over a file it cannot read", async () => {
		for (const text of ['{"version":2,"questions":[]}', "{not json"]) {
			const ports = await reviewPorts();
			ports.questions.files.set("p1", text);
			await expect(
				markQuestion(ports)(NIGHT_SHIFT, {
					spaceId: "space-1",
					projectId: "p1",
					query: "q",
					answers: ["a.md"],
					by: null,
				}),
			).rejects.toThrow("Night Shift cannot read the saved questions.");
			expect(ports.questions.files.get("p1")).toBe(text);
			expect(ports.sync.holds).toEqual(["hold p1", "done p1"]);
		}
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
