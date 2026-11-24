import { describe, expect, test } from "bun:test";
import {
	inMemoryComputer,
	ONLY_THE_OWNER,
} from "../../../access/computer/adapters/out/in-memory-computer";
import { NIGHT_SHIFT } from "../../../contract";
import { inMemorySecretsPorts } from "../../scopes/adapters/out/in-memory-neighbours";
import { removeSecret } from "./remove-secret";

/** The use case removeSecret, on in-memory adapters. */

describe("removeSecret", () => {
	test("this computer: the value, the name and its use time go in one write", async () => {
		const ports = inMemorySecretsPorts();
		ports.computer.values.set("TOKEN", "s3cret");
		ports.facts.saved().set("TOKEN", 1).set("OTHER", 2);
		ports.facts.usedAt().set("TOKEN", 3);
		await removeSecret(ports)(NIGHT_SHIFT, { name: "TOKEN" });
		expect(ports.computer.values.has("TOKEN")).toBe(false);
		expect(ports.facts.writes).toEqual([
			{ saved: new Map([["OTHER", 2]]), forget: ["TOKEN"] },
		]);
		expect(ports.facts.usedAt().has("TOKEN")).toBe(false);
	});

	test("Personal: the Personal secret goes, and this computer forgets the name", async () => {
		const ports = inMemorySecretsPorts();
		ports.personalTwin.secrets.set("TOKEN", { value: "s3cret", setAt: 1 });
		ports.known.personal.set("TOKEN", 1);
		await removeSecret(ports)(NIGHT_SHIFT, {
			name: "TOKEN",
			scope: "personal",
		});
		expect(ports.personalTwin.secrets.has("TOKEN")).toBe(false);
		expect(ports.known.personal.has("TOKEN")).toBe(false);
	});
});

test("only the owner of this computer may, and nothing happens before the check", async () => {
	const computerAccess = inMemoryComputer();
	// The other ports are not there: a use of one before the check fails.
	const act = removeSecret({ computerAccess } as never);
	expect(
		await computerAccess.whoMay((actor) => act(actor, {} as never)),
	).toEqual(ONLY_THE_OWNER);
});
