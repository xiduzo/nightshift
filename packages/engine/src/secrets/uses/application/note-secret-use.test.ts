import { describe, expect, test } from "bun:test";
import { inMemorySecretsPorts } from "../../scopes/adapters/out/in-memory-neighbours";
import { noteSecretUse } from "./note-secret-use";

/** The use case noteSecretUse, on in-memory adapters. */

describe("noteSecretUse", () => {
	test("a use writes the time at most once a minute per secret, in one write", () => {
		const ports = inMemorySecretsPorts();
		const note = noteSecretUse(ports);
		note(["A", "B", "A"]);
		expect(ports.facts.uses).toEqual([
			new Map([
				["A", 120_000],
				["B", 120_000],
			]),
		]);
		ports.clock.now = 150_000;
		note(["A"]);
		expect(ports.facts.uses).toHaveLength(1);
		ports.clock.now = 180_000;
		note(["A"]);
		expect(ports.facts.uses.at(-1)).toEqual(
			new Map([
				["A", 180_000],
				["B", 120_000],
			]),
		);
	});

	test("a failed write never holds up the use", async () => {
		const ports = inMemorySecretsPorts();
		ports.facts.writeUsed = async () => {
			throw new Error("the document is closed");
		};
		expect(() => noteSecretUse(ports)(["A"])).not.toThrow();
		await Promise.resolve();
	});
});
