import { describe, expect, test } from "bun:test";
import { NIGHT_SHIFT } from "../../../contract";
import { inMemorySecretsPorts } from "../../scopes/adapters/out/in-memory-neighbours";
import { moveSecretFromProject } from "./move-secret-from-project";

/** The use case moveSecretFromProject, on in-memory adapters. */

const PROJECT = { spaceId: "space-1", projectId: "app" };

describe("moveSecretFromProject", () => {
	test("saved here first, then the Project's copy goes and this computer forgets the name", async () => {
		const ports = inMemorySecretsPorts();
		ports.projectTwin.projects.set(
			"app",
			new Map([["TOKEN", { value: "s3cret", setAt: 1 }]]),
		);
		ports.known.projectNamesOf("app").add("TOKEN");
		await moveSecretFromProject(ports)(NIGHT_SHIFT, {
			project: PROJECT,
			name: "TOKEN",
			to: "computer",
			personId: "ada",
		});
		expect(ports.computer.values.get("TOKEN")).toBe("s3cret");
		expect(ports.projectTwin.calls.map((c) => c.call)).toEqual([
			"take",
			"remove",
		]);
		expect(ports.known.projectNamesOf("app").has("TOKEN")).toBe(false);
	});

	test("a failure in the new scope keeps the Project's copy", async () => {
		const ports = inMemorySecretsPorts();
		ports.projectTwin.projects.set(
			"app",
			new Map([["TOKEN", { value: "s3cret", setAt: 1 }]]),
		);
		ports.personalTwin.fail(new Error("offline"));
		await expect(
			moveSecretFromProject(ports)(NIGHT_SHIFT, {
				project: PROJECT,
				name: "TOKEN",
				to: "personal",
				personId: "ada",
			}),
		).rejects.toThrow("offline");
		expect(ports.projectTwin.projects.get("app")?.has("TOKEN")).toBe(true);
	});

	test("refuses a name the Project has no secret of", async () => {
		const ports = inMemorySecretsPorts();
		await expect(
			moveSecretFromProject(ports)(NIGHT_SHIFT, {
				project: PROJECT,
				name: "TOKEN",
				to: "computer",
				personId: "ada",
			}),
		).rejects.toThrow("TOKEN is not a secret of this project.");
	});
});
