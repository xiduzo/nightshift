import { describe, expect, test } from "bun:test";
import {
	allowing,
	inMemoryAccess,
} from "../../../access/adapters/out/in-memory-access";
import { NIGHT_SHIFT } from "../../../contract";
import { inMemoryLearningEntries } from "../adapters/out/in-memory-neighbours";
import { setLearnsFromRuns } from "./set-learns-from-runs";

/** The use case setLearnsFromRuns, on in-memory adapters. */

describe("setLearnsFromRuns", () => {
	test("turns the learnings from runs off and on for the project", async () => {
		const documents = inMemoryLearningEntries();
		const set = setLearnsFromRuns({
			access: inMemoryAccess(),
			documents,
		});
		await set({
			actor: NIGHT_SHIFT,
			spaceId: "space-1",
			projectId: "p1",
			on: false,
		});
		expect(documents.learnsFromRuns.get("p1")).toBe(false);
		await set({
			actor: NIGHT_SHIFT,
			spaceId: "space-1",
			projectId: "p1",
			on: true,
		});
		expect(documents.learnsFromRuns.get("p1")).toBe(true);
		expect(documents.learnsFromRuns.has("p2")).toBe(false);
	});

	test("owners, admins and members may, and nobody else", async () => {
		const ports = {
			access: inMemoryAccess(),
			documents: inMemoryLearningEntries(),
		};
		expect(
			await ports.access.whoMay(
				"space-1",
				(actor) =>
					setLearnsFromRuns(ports)({
						actor,
						spaceId: "space-1",
						projectId: "p1",
						on: false,
					}),
				() => [...ports.documents.learnsFromRuns],
			),
		).toEqual(allowing("owner", "admin", "member"));
	});
});
