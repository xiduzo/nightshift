import { describe, expect, test } from "bun:test";
import {
	allowing,
	inMemoryAccess,
} from "../../../access/adapters/out/in-memory-access";
import { NIGHT_SHIFT } from "../../../contract";
import { inMemoryKnowledgeDocuments } from "../../sync/adapters/out/in-memory-knowledge-documents";
import { chooseReader } from "./choose-reader";

/** The use case chooseReader, on in-memory adapters. */

describe("chooseReader", () => {
	test("saves the project's reader and gives it back as saved", async () => {
		const documents = inMemoryKnowledgeDocuments();
		const setting = { kind: "jina", secret: "TEAM_JINA" } as const;
		expect(
			await chooseReader({ access: inMemoryAccess(), documents })({
				actor: NIGHT_SHIFT,
				spaceId: "space-1",
				projectId: "p1",
				setting,
			}),
		).toEqual(setting);
		expect(documents.changes).toEqual(["p1"]);
		expect((await documents.open("p1")).reader()).toEqual(setting);
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
					chooseReader(ports)({
						actor,
						spaceId: "space-1",
						projectId: "p1",
						setting: { kind: "jina", secret: "TEAM_JINA" },
					}),
				() => ports.documents.changes,
			),
		).toEqual(allowing("owner", "admin", "member"));
	});
});
