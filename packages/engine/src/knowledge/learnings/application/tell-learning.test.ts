import { describe, expect, test } from "bun:test";
import { formatLearnings } from "@nightshift/flows";
import type { Refusal } from "@nightshift/refusal";
import { allowing } from "../../../access/adapters/out/in-memory-access";
import { NIGHT_SHIFT } from "../../../contract";
import { inMemoryLearningsPorts } from "../adapters/out/in-memory-neighbours";
import { tellLearning } from "./tell-learning";

/** The use case tellLearning, on in-memory adapters. Twins of the told notes in `learnings.test.ts`. */

const PROPOSED = "learnings/proposed/run-1.s1.md";
const TOLD = "learnings/accepted/told-person-ada.md";
const ADA = { id: "person-ada", name: "Ada" };

/** What a request refuses with, or null. */
const refusalOf = (work: Promise<unknown>) =>
	work.then(
		() => null,
		(error: unknown) => error as Refusal,
	);

describe("tellLearning", () => {
	test("a told note goes to the person's own file, with who told it and when", async () => {
		const ports = inMemoryLearningsPorts();
		await tellLearning(ports)({
			actor: NIGHT_SHIFT,
			spaceId: "space-1",
			projectId: "p1",
			note: "Ask Bo.",
			by: ADA,
		});
		expect(ports.folder.read("p1", TOLD)).toContain(
			"- Ask Bo.\n  Told by Ada on 2023-11-14.\n",
		);
		expect(ports.holds.log).toEqual(["hold p1", "done p1"]);
	});

	test("refuses an empty note before it holds the folder", async () => {
		const ports = inMemoryLearningsPorts();
		const refusal = await refusalOf(
			tellLearning(ports)({
				actor: NIGHT_SHIFT,
				spaceId: "space-1",
				projectId: "p1",
				note: "  ",
				by: ADA,
			}),
		);
		expect(refusal?.kind).toBe("invalid");
		expect(refusal?.message).toBe("Write the note first.");
		expect(ports.holds.log).toEqual([]);
	});

	test("a told note replaces the note it changes, and keeps nothing when that note is gone", async () => {
		const ports = inMemoryLearningsPorts();
		ports.folder.put(
			"p1",
			PROPOSED,
			formatLearnings(["One."], { runId: "run-1", isNew: true }),
		);
		const replaces = { id: "run-1.s1.md", index: 0, note: "One." };
		await tellLearning(ports)({
			actor: NIGHT_SHIFT,
			spaceId: "space-1",
			projectId: "p1",
			note: "One, better.",
			by: ADA,
			replaces,
		});
		expect(ports.folder.read("p1", TOLD)).toContain("- One, better.");
		expect(ports.folder.read("p1", PROPOSED)).toBeUndefined();
		const refusal = await refusalOf(
			tellLearning(ports)({
				actor: NIGHT_SHIFT,
				spaceId: "space-1",
				projectId: "p1",
				note: "Again.",
				by: ADA,
				replaces,
			}),
		);
		expect(refusal?.kind).toBe("not-found");
		expect(ports.folder.read("p1", TOLD)).not.toContain("Again.");
	});

	test("owners, admins and members may, and nobody else", async () => {
		const ports = inMemoryLearningsPorts();
		expect(
			await ports.access.whoMay(
				"space-1",
				(actor) =>
					tellLearning(ports)({
						actor,
						spaceId: "space-1",
						projectId: "p1",
						note: "Ask Bo.",
						by: ADA,
					}),
				() => ports.holds.log,
			),
		).toEqual(allowing("owner", "admin", "member"));
	});
});
