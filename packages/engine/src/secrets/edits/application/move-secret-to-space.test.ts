import { describe, expect, test } from "bun:test";
import { NIGHT_SHIFT } from "../../../contract";
import { inMemorySecretsPorts } from "../../scopes/adapters/out/in-memory-neighbours";
import { moveSecretToSpace } from "./move-secret-to-space";

/** The use case moveSecretToSpace, on in-memory adapters. */

describe("moveSecretToSpace", () => {
	test("saved in the Space first, then this computer's copy goes", async () => {
		const ports = inMemorySecretsPorts();
		ports.computer.values.set("TOKEN", "s3cret");
		ports.facts.saved().set("TOKEN", 1);
		await moveSecretToSpace(ports)(NIGHT_SHIFT, {
			name: "TOKEN",
			from: "computer",
			spaceId: "space-1",
			personId: "ada",
		});
		expect(ports.projectTwin.spaces.get("space-1")?.get("TOKEN")?.value).toBe(
			"s3cret",
		);
		expect(ports.computer.values.has("TOKEN")).toBe(false);
	});

	test("a refusal of the keeper keeps the Personal copy", async () => {
		const ports = inMemorySecretsPorts();
		ports.personalTwin.secrets.set("TOKEN", { value: "s3cret", setAt: 1 });
		ports.projectTwin.fail(new Error("refused"));
		await expect(
			moveSecretToSpace(ports)(NIGHT_SHIFT, {
				name: "TOKEN",
				from: "personal",
				spaceId: "space-1",
				personId: "ada",
			}),
		).rejects.toThrow("refused");
		expect(ports.personalTwin.secrets.has("TOKEN")).toBe(true);
	});

	test("refuses a name the scope has no value of", async () => {
		const ports = inMemorySecretsPorts();
		await expect(
			moveSecretToSpace(ports)(NIGHT_SHIFT, {
				name: "TOKEN",
				from: "personal",
				spaceId: "space-1",
				personId: "ada",
			}),
		).rejects.toThrow("TOKEN is not a Personal secret.");
	});
});
