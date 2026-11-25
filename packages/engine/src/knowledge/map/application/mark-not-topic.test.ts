import { describe, expect, test } from "bun:test";
import { allowing } from "../../../access/adapters/out/in-memory-access";
import { NIGHT_SHIFT } from "../../../contract";
import { inMemoryMapPorts } from "../adapters/out/in-memory-neighbours";
import { parseNotTopics } from "../domain/not-topics";
import { markNotTopic } from "./mark-not-topic";

/** The use case markNotTopic, on in-memory adapters. */

describe("markNotTopic", () => {
	test("marks a word under a hold of the folder, newest first, and puts it back", async () => {
		const ports = inMemoryMapPorts();
		const mark = markNotTopic(ports);
		ports.setNow(5);
		expect(
			await mark(NIGHT_SHIFT, {
				spaceId: "space-1",
				projectId: "p1",
				word: "deploy",
				notTopic: true,
				by: "ada",
			}),
		).toEqual(["deploy"]);
		ports.setNow(6);
		expect(
			await mark(NIGHT_SHIFT, {
				spaceId: "space-1",
				projectId: "p1",
				word: "  Night   shift ",
				notTopic: true,
				by: null,
			}),
		).toEqual(["Night shift", "deploy"]);
		expect(parseNotTopics(ports.notTopics.files.get("p1") ?? null)).toEqual([
			{ word: "Night shift", markedAt: 6, by: null },
			{ word: "deploy", markedAt: 5, by: "ada" },
		]);
		expect(
			await mark(NIGHT_SHIFT, {
				spaceId: "space-1",
				projectId: "p1",
				word: "DEPLOY",
				notTopic: false,
				by: null,
			}),
		).toEqual(["Night shift"]);
		expect(ports.sync.holds).toEqual([
			"hold p1",
			"done p1",
			"hold p1",
			"done p1",
			"hold p1",
			"done p1",
		]);
	});

	test("keeps each word of the file it cannot read, as it is and in its place", async () => {
		const ports = inMemoryMapPorts();
		const stored = () => JSON.parse(ports.notTopics.files.get("p1") ?? "null");
		const extra = { word: "kept", markedAt: 1, by: null, note: "x" };
		ports.notTopics.files.set(
			"p1",
			JSON.stringify({ version: 1, words: ["old", extra, 7], more: true }),
		);
		ports.setNow(5);
		const mark = (word: string, notTopic: boolean) =>
			markNotTopic(ports)(NIGHT_SHIFT, {
				spaceId: "space-1",
				projectId: "p1",
				word,
				notTopic,
				by: null,
			});
		expect(await mark("new", true)).toEqual(["new", "kept"]);
		expect(stored()).toEqual({
			version: 1,
			words: [{ word: "new", markedAt: 5, by: null }, "old", extra, 7],
			more: true,
		});
		await mark("kept", false);
		await mark("new", false);
		expect(stored().words).toEqual(["old", 7]);
	});

	test("refuses to write over a file it cannot read", async () => {
		for (const text of ['{"version":2,"words":[]}', "{not json"]) {
			const ports = inMemoryMapPorts();
			ports.notTopics.files.set("p1", text);
			await expect(
				markNotTopic(ports)(NIGHT_SHIFT, {
					spaceId: "space-1",
					projectId: "p1",
					word: "deploy",
					notTopic: true,
					by: null,
				}),
			).rejects.toThrow("Night Shift cannot read the saved words.");
			expect(ports.notTopics.files.get("p1")).toBe(text);
			expect(ports.sync.holds).toEqual(["hold p1", "done p1"]);
		}
	});

	test("ends the hold when the write fails", async () => {
		const ports = inMemoryMapPorts();
		const failure = new Error("disk");
		ports.notTopics.write = async () => {
			throw failure;
		};
		const refusal = await markNotTopic(ports)(NIGHT_SHIFT, {
			spaceId: "space-1",
			projectId: "p1",
			word: "deploy",
			notTopic: true,
			by: null,
		}).catch((error: unknown) => error);
		expect(refusal).toBe(failure);
		expect(ports.sync.holds).toEqual(["hold p1", "done p1"]);
	});

	test("owners, admins and members may, and nobody else", async () => {
		const ports = inMemoryMapPorts();
		expect(
			await ports.access.whoMay(
				"space-1",
				(actor) =>
					markNotTopic(ports)(actor, {
						spaceId: "space-1",
						projectId: "p1",
						word: "deploy",
						notTopic: true,
						by: null,
					}),
				() => ports.sync.holds,
			),
		).toEqual(allowing("owner", "admin", "member"));
	});
});
