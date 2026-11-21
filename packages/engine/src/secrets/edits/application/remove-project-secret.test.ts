import { describe, expect, test } from "bun:test";
import { NIGHT_SHIFT } from "../../../contract";
import { inMemorySecretsPorts } from "../../scopes/adapters/out/in-memory-neighbours";
import { removeProjectSecret } from "./remove-project-secret";

/** The use case removeProjectSecret, on in-memory adapters. */

const PROJECT = { spaceId: "space-1", projectId: "app" };

describe("removeProjectSecret", () => {
	test("the keeper removes it as the Person, and this computer forgets the name", async () => {
		const ports = inMemorySecretsPorts();
		ports.projectTwin.projects.set(
			"app",
			new Map([["TOKEN", { value: "s3cret", setAt: 1 }]]),
		);
		ports.known.projectNamesOf("app").add("TOKEN");
		await removeProjectSecret(ports)(NIGHT_SHIFT, {
			project: PROJECT,
			name: "TOKEN",
			personId: "ada",
		});
		expect(ports.projectTwin.projects.get("app")?.has("TOKEN")).toBe(false);
		expect(ports.known.projectNamesOf("app").has("TOKEN")).toBe(false);
	});

	test("a refusal of the keeper keeps the name in memory", async () => {
		const ports = inMemorySecretsPorts();
		ports.known.projectNamesOf("app").add("TOKEN");
		ports.projectTwin.fail(new Error("Only a Member who saves flows may."));
		await expect(
			removeProjectSecret(ports)(NIGHT_SHIFT, {
				project: PROJECT,
				name: "TOKEN",
				personId: "viewer",
			}),
		).rejects.toThrow("Only a Member who saves flows may.");
		expect(ports.known.projectNamesOf("app").has("TOKEN")).toBe(true);
	});
});
