import { describe, expect, test } from "bun:test";
import {
	allowing,
	inMemoryAccess,
} from "../../../access/adapters/out/in-memory-access";
import { NIGHT_SHIFT } from "../../../contract";
import { inMemoryKnowledgeDocuments } from "../../sync/adapters/out/in-memory-knowledge-documents";
import { setLearnsFromRuns } from "./set-learns-from-runs";

/** The use case setLearnsFromRuns, on in-memory adapters. */

describe("setLearnsFromRuns", () => {
	test("turns the learnings from runs off and on for the project", async () => {
		const documents = inMemoryKnowledgeDocuments();
		const on = async (projectId: string) =>
			(await documents.open(projectId)).learnsFromRunsOn();
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
		expect(await on("p1")).toBe(false);
		await set({
			actor: NIGHT_SHIFT,
			spaceId: "space-1",
			projectId: "p1",
			on: true,
		});
		expect(await on("p1")).toBe(true);
		expect(documents.changes).toEqual(["p1", "p1"]);
	});

	test("owners, admins and members may, and nobody else", async () => {
		const ports = {
			access: inMemoryAccess(),
			documents: inMemoryKnowledgeDocuments(),
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
				() => ports.documents.changes,
			),
		).toEqual(allowing("owner", "admin", "member"));
	});
});
