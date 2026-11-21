import { describe, expect, test } from "bun:test";
import { NIGHT_SHIFT } from "../../../contract";
import { inMemorySecretsPorts } from "../../scopes/adapters/out/in-memory-neighbours";
import { moveSecret } from "./move-secret";

/** The use case moveSecret, on in-memory adapters. */

describe("moveSecret", () => {
	test("to Personal: saved there first, then this computer's copy goes", async () => {
		const ports = inMemorySecretsPorts();
		ports.computer.values.set("TOKEN", "s3cret");
		ports.facts.saved().set("TOKEN", 1);
		await moveSecret(ports)(NIGHT_SHIFT, { name: "TOKEN", to: "personal" });
		expect(ports.personalTwin.secrets.get("TOKEN")?.value).toBe("s3cret");
		expect(ports.computer.values.has("TOKEN")).toBe(false);
		expect(ports.facts.saved().has("TOKEN")).toBe(false);
	});

	test("to this computer: saved here first, then the Personal copy goes", async () => {
		const ports = inMemorySecretsPorts();
		ports.personalTwin.secrets.set("TOKEN", { value: "s3cret", setAt: 1 });
		await moveSecret(ports)(NIGHT_SHIFT, { name: "TOKEN", to: "computer" });
		expect(ports.computer.values.get("TOKEN")).toBe("s3cret");
		expect(ports.personalTwin.secrets.has("TOKEN")).toBe(false);
		expect(ports.personalTwin.calls.map((c) => c.call)).toEqual([
			"values",
			"remove",
		]);
	});

	test("a failure in the new scope keeps the old copy", async () => {
		const ports = inMemorySecretsPorts();
		ports.computer.values.set("TOKEN", "s3cret");
		ports.facts.saved().set("TOKEN", 1);
		ports.personalTwin.fail(new Error("offline"));
		await expect(
			moveSecret(ports)(NIGHT_SHIFT, { name: "TOKEN", to: "personal" }),
		).rejects.toThrow("offline");
		expect(ports.computer.values.get("TOKEN")).toBe("s3cret");
		expect(ports.facts.saved().has("TOKEN")).toBe(true);
	});

	test("refuses a name the scope has no value of, in words that name it", async () => {
		const ports = inMemorySecretsPorts();
		const move = moveSecret(ports);
		await expect(
			move(NIGHT_SHIFT, { name: "TOKEN", to: "personal" }),
		).rejects.toThrow("This computer has no saved value of TOKEN.");
		await expect(
			move(NIGHT_SHIFT, { name: "TOKEN", to: "computer" }),
		).rejects.toThrow("TOKEN is not a Personal secret.");
	});
});
