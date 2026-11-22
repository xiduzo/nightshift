import { describe, expect, test } from "bun:test";
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
			await mark({
				projectId: "p1",
				word: "deploy",
				notTopic: true,
				by: "ada",
			}),
		).toEqual(["deploy"]);
		ports.setNow(6);
		expect(
			await mark({
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
			await mark({
				projectId: "p1",
				word: "DEPLOY",
				notTopic: false,
				by: null,
			}),
		).toEqual(["Night shift"]);
		expect(ports.holds.events).toEqual([
			"hold p1",
			"done p1",
			"hold p1",
			"done p1",
			"hold p1",
			"done p1",
		]);
	});

	test("ends the hold when the write fails", async () => {
		const ports = inMemoryMapPorts();
		const failure = new Error("disk");
		ports.notTopics.write = async () => {
			throw failure;
		};
		const refusal = await markNotTopic(ports)({
			projectId: "p1",
			word: "deploy",
			notTopic: true,
			by: null,
		}).catch((error: unknown) => error);
		expect(refusal).toBe(failure);
		expect(ports.holds.events).toEqual(["hold p1", "done p1"]);
	});
});
