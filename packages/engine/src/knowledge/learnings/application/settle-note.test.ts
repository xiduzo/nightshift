import { describe, expect, test } from "bun:test";
import { formatLearnings } from "@nightshift/flows";
import type { Refusal } from "@nightshift/refusal";
import { allowing } from "../../../access/adapters/out/in-memory-access";
import { NIGHT_SHIFT } from "../../../contract";
import { inMemoryLearningsPorts } from "../adapters/out/in-memory-neighbours";
import { settleNote } from "./settle-note";

/** The use case settleNote, on in-memory adapters. Twins of "one note at a time" in `learnings.test.ts`. */

const PROPOSED = "learnings/proposed/run-1.s1.md";
const ACCEPTED = "learnings/accepted/run-1.s1.md";
const ADA = { id: "person-ada", name: "Ada" };

/** What a request refuses with, or null. */
const refusalOf = (work: Promise<unknown>) =>
	work.then(
		() => null,
		(error: unknown) => error as Refusal,
	);

function setup(notes = ["One.", "Two."]) {
	const ports = inMemoryLearningsPorts();
	ports.folder.put(
		"p1",
		PROPOSED,
		formatLearnings(notes, { runId: "run-1", isNew: true }),
	);
	return ports;
}

describe("settleNote", () => {
	test("keeps one note with who kept it and when, and leaves the others waiting", async () => {
		const ports = setup();
		await settleNote(ports)({
			actor: NIGHT_SHIFT,
			spaceId: "space-1",
			projectId: "p1",
			note: { id: "run-1.s1.md", index: 0, note: "One." },
			decision: "keep",
			by: ADA,
		});
		const kept = ports.folder.read("p1", ACCEPTED) ?? "";
		expect(kept).toContain("- One.\n  Kept by Ada on 2023-11-14.\n");
		expect(ports.folder.read("p1", PROPOSED)).toContain("- Two.");
		expect(ports.folder.read("p1", PROPOSED)).not.toContain("- One.");
		expect(ports.holds.log).toEqual(["hold p1", "done p1"]);
	});

	test("a delete of the last note keeps nothing, and the proposed file goes", async () => {
		const ports = setup(["One."]);
		await settleNote(ports)({
			actor: NIGHT_SHIFT,
			spaceId: "space-1",
			projectId: "p1",
			note: { id: "run-1.s1.md", index: 0 },
			decision: "delete",
			by: ADA,
		});
		expect([...ports.folder.files.keys()]).toEqual([]);
	});

	test("finds a note that moved by its text, and refuses one that is gone", async () => {
		const ports = setup();
		await settleNote(ports)({
			actor: NIGHT_SHIFT,
			spaceId: "space-1",
			projectId: "p1",
			note: { id: "run-1.s1.md", index: 1, note: "One." },
			decision: "delete",
			by: ADA,
		});
		expect(ports.folder.read("p1", PROPOSED)).toContain("- Two.");
		const refusal = await refusalOf(
			settleNote(ports)({
				actor: NIGHT_SHIFT,
				spaceId: "space-1",
				projectId: "p1",
				note: { id: "run-1.s1.md", index: 0, note: "One." },
				decision: "keep",
				by: ADA,
			}),
		);
		expect(refusal?.message).toBe(
			"This note no longer waits. Someone kept, changed or deleted it.",
		);
		const missing = (id: string, index: number) =>
			refusalOf(
				settleNote(ports)({
					actor: NIGHT_SHIFT,
					spaceId: "space-1",
					projectId: "p1",
					note: { id, index },
					decision: "keep",
					by: ADA,
				}),
			);
		expect((await missing("run-1.s1.md", 5))?.message).toContain(
			"This note no longer waits.",
		);
		expect((await missing("../x.md", 0))?.message).toContain(
			"This learning no longer waits.",
		);
		expect(ports.folder.read("p1", ACCEPTED)).toBeUndefined();
	});

	test("waits to be fetched when the Space lists a file this folder does not have", async () => {
		const ports = inMemoryLearningsPorts();
		ports.documents.list("p1", PROPOSED, { sha256: "a", changedAt: 1 });
		const refusal = await refusalOf(
			settleNote(ports)({
				actor: NIGHT_SHIFT,
				spaceId: "space-1",
				projectId: "p1",
				note: { id: "run-1.s1.md", index: 0 },
				decision: "keep",
				by: ADA,
			}),
		);
		expect(refusal?.kind).toBe("unavailable");
	});

	test("owners, admins and members may, and nobody else", async () => {
		const ports = setup();
		expect(
			await ports.access.whoMay(
				"space-1",
				(actor) =>
					settleNote(ports)({
						actor,
						spaceId: "space-1",
						projectId: "p1",
						note: { id: "run-1.s1.md", index: 0 },
						decision: "delete",
						by: ADA,
					}),
				() => ports.holds.log,
			),
		).toEqual(allowing("owner", "admin", "member"));
	});
});
