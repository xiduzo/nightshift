import { describe, expect, test } from "bun:test";
import { migratedDb } from "@nightshift/db/testing";
import { openDeviceDocument } from "../../../../documents";
import { inMemorySecretFacts } from "./in-memory-secret-facts";
import { secretFactsContract } from "./secret-facts.contract";
import { yjsSecretFacts } from "./yjs-secret-facts";

/**
 * The contract of `SecretFacts`, on both adapters. The real side runs on
 * libsql in memory: the Device document of a migrated database.
 */

secretFactsContract("in memory", async () => ({
	facts: inMemorySecretFacts(),
	close: async () => {},
}));

async function deviceDocument() {
	const db = await migratedDb();
	return openDeviceDocument({ db, deviceId: "device-1" });
}

secretFactsContract("the Device document, on libsql in memory", async () => ({
	facts: yjsSecretFacts(await deviceDocument()),
	close: async () => {},
}));

describe("the Device document holds names and times only", () => {
	test("a write of the saved names with a forget is one change of the document", async () => {
		const document = await deviceDocument();
		const facts = yjsSecretFacts(document);
		await facts.writeUsed(new Map([["TOKEN", 1]]));
		let changes = 0;
		document.facts.observe(() => {
			changes += 1;
		});
		await facts.writeSaved(new Map([["OTHER", 3]]), ["TOKEN"]);
		expect(changes).toBe(1);
		expect(document.facts.get("secrets")).toEqual([
			{ name: "OTHER", setAt: 3 },
		]);
		expect(document.facts.get("secretsUsedAt")).toEqual({});
	});

	test("an item that is not a name with its time is left out", async () => {
		const document = await deviceDocument();
		await document.change(() => {
			document.facts.set("secrets", ["OLD", { name: "NEW", setAt: 4 }, 7]);
		});
		expect([...yjsSecretFacts(document).saved()]).toEqual([["NEW", 4]]);
	});

	test("a write keeps each entry it cannot read, as it is and in its place", async () => {
		const document = await deviceDocument();
		const later = { name: "LATER", setAt: { by: "ada" } };
		const extra = { name: "KEPT", setAt: 2, from: "vault" };
		await document.change(() => {
			document.facts.set("secrets", ["OLD", extra, later, 7]);
			document.facts.set("secretsUsedAt", { KEPT: 3, LATER: { at: 4 } });
		});
		const facts = yjsSecretFacts(document);
		await facts.writeSaved(new Map([...facts.saved(), ["NEW", 5]]));
		expect(document.facts.get("secrets")).toEqual([
			"OLD",
			extra,
			later,
			7,
			{ name: "NEW", setAt: 5 },
		]);
		await facts.writeSaved(new Map([["NEW", 6]]), ["KEPT"]);
		expect(document.facts.get("secrets")).toEqual([
			"OLD",
			{ name: "NEW", setAt: 6 },
			later,
			7,
		]);
		expect(document.facts.get("secretsUsedAt")).toEqual({ LATER: { at: 4 } });
		await facts.writeUsed(new Map([["NEW", 8]]));
		expect(document.facts.get("secretsUsedAt")).toEqual({
			LATER: { at: 4 },
			NEW: 8,
		});
	});
});
