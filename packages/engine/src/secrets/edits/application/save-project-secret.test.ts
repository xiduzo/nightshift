import { describe, expect, test } from "bun:test";
import { NIGHT_SHIFT } from "../../../contract";
import { inMemorySecretsPorts } from "../../scopes/adapters/out/in-memory-neighbours";
import { saveProjectSecret } from "./save-project-secret";

/** The use case saveProjectSecret, on in-memory adapters. */

const PROJECT = { spaceId: "space-1", projectId: "app" };

describe("saveProjectSecret", () => {
	test("the keeper saves it as the Person, and this computer remembers the name", async () => {
		const ports = inMemorySecretsPorts();
		await saveProjectSecret(ports)(NIGHT_SHIFT, {
			project: PROJECT,
			name: "TOKEN",
			value: "s3cret",
			personId: "ada",
		});
		expect(ports.projectTwin.projects.get("app")?.get("TOKEN")?.value).toBe(
			"s3cret",
		);
		expect(ports.projectTwin.calls).toEqual([
			{ call: "set", args: [PROJECT, "TOKEN", "ada"] },
		]);
		expect(ports.known.projectNamesOf("app").has("TOKEN")).toBe(true);
	});

	test("refuses an empty value before it asks the keeper", async () => {
		const ports = inMemorySecretsPorts();
		await expect(
			saveProjectSecret(ports)(NIGHT_SHIFT, {
				project: PROJECT,
				name: "TOKEN",
				value: "",
				personId: "ada",
			}),
		).rejects.toThrow("A secret needs a value.");
		expect(ports.projectTwin.calls).toEqual([]);
	});
});
