import { describe, expect, test } from "bun:test";
import { NIGHT_SHIFT } from "../../../contract";
import { inMemorySecretsPorts } from "../../scopes/adapters/out/in-memory-neighbours";
import { saveSecret } from "./save-secret";

/** The use case saveSecret, on in-memory adapters. */

describe("saveSecret", () => {
	test("this computer: the value goes to the keychain, only the name and the time to the document", async () => {
		const ports = inMemorySecretsPorts();
		await saveSecret(ports)(NIGHT_SHIFT, { name: "TOKEN", value: "s3cret" });
		expect(ports.computer.values.get("TOKEN")).toBe("s3cret");
		expect(ports.facts.writes).toEqual([
			{ saved: new Map([["TOKEN", 120_000]]), forget: [] },
		]);
		expect(JSON.stringify([...ports.facts.saved()])).not.toContain("s3cret");
	});

	test("Personal: the value goes to the Personal secrets, and the listeners hear it", async () => {
		const ports = inMemorySecretsPorts();
		let heard = 0;
		ports.known.onPersonalChange(() => {
			heard += 1;
		});
		await saveSecret(ports)(NIGHT_SHIFT, {
			name: "TOKEN",
			value: "s3cret",
			scope: "personal",
		});
		expect(ports.personalTwin.secrets.get("TOKEN")?.value).toBe("s3cret");
		expect(ports.known.personal.get("TOKEN")).toBe(120_000);
		expect(ports.facts.writes).toEqual([]);
		expect(heard).toBe(1);
	});

	test("refuses an empty value and a bad name, and saves nothing", async () => {
		const ports = inMemorySecretsPorts();
		const save = saveSecret(ports);
		await expect(
			save(NIGHT_SHIFT, { name: "TOKEN", value: "" }),
		).rejects.toThrow("A secret needs a value.");
		for (const name of [
			"not a name",
			"1STARTS_WITH_DIGIT",
			"has-dash",
			"",
			`A${"x".repeat(128)}`,
		]) {
			await expect(save(NIGHT_SHIFT, { name, value: "x" })).rejects.toThrow();
		}
		expect(ports.computer.values.size).toBe(0);
		expect(ports.facts.writes).toEqual([]);
		await save(NIGHT_SHIFT, { name: "_my_token_2", value: "x" });
		expect(ports.computer.values.has("_my_token_2")).toBe(true);
	});

	test("refuses a Personal save while the Personal secrets cannot be reached", async () => {
		const ports = inMemorySecretsPorts();
		ports.unreach("personal");
		await expect(
			saveSecret(ports)(NIGHT_SHIFT, {
				name: "TOKEN",
				value: "x",
				scope: "personal",
			}),
		).rejects.toThrow("Night Shift could not read your Personal secrets now.");
	});
});
