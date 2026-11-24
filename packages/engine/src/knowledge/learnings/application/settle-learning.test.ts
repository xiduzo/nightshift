import { describe, expect, test } from "bun:test";
import { formatLearnings } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import { allowing } from "../../../access/adapters/out/in-memory-access";
import { NIGHT_SHIFT } from "../../../contract";
import { inMemoryLearningsPorts } from "../adapters/out/in-memory-neighbours";
import { settleLearning } from "./settle-learning";

/** The use case settleLearning, on in-memory adapters. Twins of "settle" in `learnings.test.ts`. */

const PROPOSED = "learnings/proposed/run-1.s1.md";
const TEXT = formatLearnings(["One.", "Two."], { runId: "run-1", isNew: true });

/** What a request refuses with, or null. */
const refusalOf = (work: Promise<unknown>) =>
	work.then(
		() => null,
		(error: unknown) => error,
	);

describe("settleLearning", () => {
	test("keep adds the file to the accepted learnings and takes it out of the proposed ones, in a hold", async () => {
		const ports = inMemoryLearningsPorts();
		ports.folder.put("p1", PROPOSED, TEXT);
		await settleLearning(ports)({
			actor: NIGHT_SHIFT,
			spaceId: "space-1",
			projectId: "p1",
			id: "run-1.s1.md",
			decision: "keep",
		});
		expect(ports.folder.read("p1", "learnings/accepted/run-1.s1.md")).toBe(
			TEXT,
		);
		expect(ports.folder.read("p1", PROPOSED)).toBeUndefined();
		expect(ports.sync.holds).toEqual(["hold p1", "done p1"]);
	});

	test("delete keeps nothing", async () => {
		const ports = inMemoryLearningsPorts();
		ports.folder.put("p1", PROPOSED, TEXT);
		await settleLearning(ports)({
			actor: NIGHT_SHIFT,
			spaceId: "space-1",
			projectId: "p1",
			id: "run-1.s1.md",
			decision: "delete",
		});
		expect([...ports.folder.files.keys()]).toEqual([]);
	});

	test("refuses a name that is no proposed learning, before it holds the folder", async () => {
		const ports = inMemoryLearningsPorts();
		const refusal = await refusalOf(
			settleLearning(ports)({
				actor: NIGHT_SHIFT,
				spaceId: "space-1",
				projectId: "p1",
				id: "../x.md",
				decision: "keep",
			}),
		);
		expect(refusal).toBeInstanceOf(Refusal);
		expect((refusal as Refusal).message).toBe(
			"This learning no longer waits. Someone kept or deleted it.",
		);
		expect(ports.sync.holds).toEqual([]);
	});

	test("waits to be fetched when the Space lists a file this folder does not have", async () => {
		const ports = inMemoryLearningsPorts();
		await ports.sync.publish("p1", PROPOSED, TEXT, 1, "nowhere");
		const refusal = await refusalOf(
			settleLearning(ports)({
				actor: NIGHT_SHIFT,
				spaceId: "space-1",
				projectId: "p1",
				id: "run-1.s1.md",
				decision: "keep",
			}),
		);
		expect((refusal as Refusal).kind).toBe("unavailable");
		expect(ports.sync.holds).toEqual(["hold p1", "done p1"]);
		const gone = await refusalOf(
			settleLearning(ports)({
				actor: NIGHT_SHIFT,
				spaceId: "space-1",
				projectId: "p1",
				id: "run-2.s1.md",
				decision: "keep",
			}),
		);
		expect((gone as Refusal).kind).toBe("not-found");
	});

	test("owners, admins and members may, and nobody else", async () => {
		const ports = inMemoryLearningsPorts();
		ports.folder.put("p1", PROPOSED, TEXT);
		expect(
			await ports.access.whoMay(
				"space-1",
				(actor) =>
					settleLearning(ports)({
						actor,
						spaceId: "space-1",
						projectId: "p1",
						id: "run-1.s1.md",
						decision: "keep",
					}),
				() => ports.sync.holds,
			),
		).toEqual(allowing("owner", "admin", "member"));
	});
});
