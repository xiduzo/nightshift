import { describe, expect, test } from "bun:test";
import {
	allowing,
	inMemoryAccess,
} from "../../../access/adapters/out/in-memory-access";
import { NIGHT_SHIFT } from "../../../contract";
import { inMemoryMeaningSetting } from "../adapters/out/in-memory-neighbours";
import type { KnowledgeMeaningStatus } from "../domain/meaning";
import { setMeaning } from "./set-meaning";

/** The use case setMeaning, on in-memory adapters. */

const turnedOff: KnowledgeMeaningStatus = {
	state: "turned-off",
	model: null,
	done: 0,
	total: 0,
	where: null,
	percent: null,
};

describe("setMeaning", () => {
	test("writes the setting and returns how far search by meaning is", async () => {
		const documents = inMemoryMeaningSetting();
		const status = await setMeaning({
			access: inMemoryAccess(),
			documents,
			meaning: async () => turnedOff,
		})({
			actor: NIGHT_SHIFT,
			spaceId: "space-1",
			projectId: "p1",
			on: false,
		});
		expect(documents.written).toEqual([{ projectId: "p1", on: false }]);
		expect(status).toEqual(turnedOff);
	});

	test("owners, admins and members may, and nobody else", async () => {
		const ports = {
			access: inMemoryAccess(),
			documents: inMemoryMeaningSetting(),
			meaning: async () => turnedOff,
		};
		expect(
			await ports.access.whoMay(
				"space-1",
				(actor) =>
					setMeaning(ports)({
						actor,
						spaceId: "space-1",
						projectId: "p1",
						on: true,
					}),
				() => ports.documents.written,
			),
		).toEqual(allowing("owner", "admin", "member"));
	});
});
