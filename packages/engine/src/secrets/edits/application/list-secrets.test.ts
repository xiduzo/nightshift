import { describe, expect, test } from "bun:test";
import {
	inMemoryComputer,
	ONLY_THE_OWNER,
} from "../../../access/computer/adapters/out/in-memory-computer";
import { NIGHT_SHIFT } from "../../../contract";
import { inMemorySecretsPorts } from "../../scopes/adapters/out/in-memory-neighbours";
import { listSecrets } from "./list-secrets";

/** The use case listSecrets, on in-memory adapters. */

describe("listSecrets", () => {
	test("Personal, saved, referenced and named names, each with where it is set and when", async () => {
		const ports = inMemorySecretsPorts();
		ports.personalTwin.secrets.set("BOTH", { value: "p", setAt: 5 });
		ports.personalTwin.secrets.set("MINE", { value: "p", setAt: 6 });
		ports.facts.saved().set("BOTH", 7);
		ports.facts.usedAt().set("BOTH", 9);
		ports.references.references.set("REF", ["github", "jira"]);
		ports.env.REF = "env";
		const list = await listSecrets(ports)(NIGHT_SHIFT, { named: ["CMD"] });
		expect(list.personal).toBe("available");
		expect(
			list.secrets.map((s) => [s.name, s.scope, s.saved, s.setAt, s.usedAt]),
		).toEqual([
			["BOTH", "personal", true, 5, 9],
			["BOTH", "computer", true, 7, 9],
			["CMD", "computer", false, null, null],
			["MINE", "personal", true, 6, null],
			["REF", "computer", false, null, null],
		]);
		expect(list.secrets.find((s) => s.name === "REF")).toMatchObject({
			inEnv: true,
			usedBy: ["github", "jira"],
		});
	});

	test("Personal names that cannot be read now leave this computer's list, marked unavailable", async () => {
		const ports = inMemorySecretsPorts();
		ports.personalTwin.fail(new Error("offline"));
		ports.facts.saved().set("HERE", 1);
		const list = await listSecrets(ports)(NIGHT_SHIFT, {});
		expect(list.personal).toBe("unavailable");
		expect(list.secrets.map((s) => s.name)).toEqual(["HERE"]);
		expect(ports.warnings.map((w) => w.line)).toEqual([
			"[secrets] the Personal secrets were not listed:",
		]);
	});

	test("the reply holds no value", async () => {
		const ports = inMemorySecretsPorts();
		ports.personalTwin.secrets.set("MINE", {
			value: "personal-value-1",
			setAt: 1,
		});
		ports.computer.values.set("HERE", "keychain-value-2");
		ports.facts.saved().set("HERE", 1);
		ports.env.HERE = "env-value-3";
		const reply = JSON.stringify(await listSecrets(ports)(NIGHT_SHIFT, {}));
		expect(reply).not.toContain("personal-value-1");
		expect(reply).not.toContain("keychain-value-2");
		expect(reply).not.toContain("env-value-3");
	});
});

test("only the owner of this computer may, and nothing happens before the check", async () => {
	const computerAccess = inMemoryComputer();
	// The other ports are not there: a use of one before the check fails.
	const act = listSecrets({ computerAccess } as never);
	expect(
		await computerAccess.whoMay((actor) => act(actor, {} as never)),
	).toEqual(ONLY_THE_OWNER);
});
