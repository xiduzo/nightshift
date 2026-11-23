import { describe, expect, test } from "bun:test";
import { NIGHT_SHIFT } from "../../../contract";
import {
	inMemoryMeaningSetting,
	inMemorySearchAccess,
} from "../adapters/out/in-memory-neighbours";
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

const person = { personId: "ada", door: "session" as const };

describe("setMeaning", () => {
	test("writes the setting and returns how far search by meaning is", async () => {
		const documents = inMemoryMeaningSetting();
		const status = await setMeaning({
			access: inMemorySearchAccess(),
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

	test("refuses a person whose role does not allow it, before it writes", async () => {
		const access = inMemorySearchAccess();
		const refused = new Error("role");
		access.refuse(refused);
		const documents = inMemoryMeaningSetting();
		const refusal = await setMeaning({
			access,
			documents,
			meaning: async () => turnedOff,
		})({
			actor: person,
			spaceId: "space-1",
			projectId: "p1",
			on: true,
		}).catch((error: unknown) => error);
		expect(refusal).toBe(refused);
		expect(documents.written).toEqual([]);
	});
});
