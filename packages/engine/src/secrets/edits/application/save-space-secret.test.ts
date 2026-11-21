import { describe, expect, test } from "bun:test";
import { NIGHT_SHIFT } from "../../../contract";
import { inMemorySecretsPorts } from "../../scopes/adapters/out/in-memory-neighbours";
import { saveSpaceSecret } from "./save-space-secret";

/** The use case saveSpaceSecret, on in-memory adapters. */

describe("saveSpaceSecret", () => {
	test("the keeper saves it as the Person", async () => {
		const ports = inMemorySecretsPorts();
		await saveSpaceSecret(ports)(NIGHT_SHIFT, {
			spaceId: "space-1",
			name: "TOKEN",
			value: "s3cret",
			personId: "ada",
		});
		expect(ports.projectTwin.spaces.get("space-1")?.get("TOKEN")?.value).toBe(
			"s3cret",
		);
		expect(ports.projectTwin.calls).toEqual([
			{ call: "space.set", args: ["space-1", "TOKEN", "ada"] },
		]);
	});

	test("refuses an empty value before it asks the keeper", async () => {
		const ports = inMemorySecretsPorts();
		await expect(
			saveSpaceSecret(ports)(NIGHT_SHIFT, {
				spaceId: "space-1",
				name: "TOKEN",
				value: "",
				personId: "ada",
			}),
		).rejects.toThrow("A secret needs a value.");
		expect(ports.projectTwin.calls).toEqual([]);
	});
});
