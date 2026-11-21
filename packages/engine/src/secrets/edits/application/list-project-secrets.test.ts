import { describe, expect, test } from "bun:test";
import { NIGHT_SHIFT } from "../../../contract";
import { inMemorySecretsPorts } from "../../scopes/adapters/out/in-memory-neighbours";
import { listProjectSecrets } from "./list-project-secrets";

/** The use case listProjectSecrets, on in-memory adapters. */

const PROJECT = { spaceId: "space-1", projectId: "app" };

describe("listProjectSecrets", () => {
	test("the keeper's names for the Person, which this computer remembers", async () => {
		const ports = inMemorySecretsPorts();
		ports.projectTwin.projects.set(
			"app",
			new Map([["TOKEN", { value: "project-value", setAt: 4 }]]),
		);
		ports.known.projectNamesOf("app").add("GONE");
		const listed = await listProjectSecrets(ports)(NIGHT_SHIFT, {
			project: PROJECT,
			personId: "ada",
		});
		expect(listed).toEqual([{ name: "TOKEN", setAt: 4, setBy: null }]);
		expect(JSON.stringify(listed)).not.toContain("project-value");
		expect([...ports.known.projectNamesOf("app")]).toEqual(["TOKEN"]);
		expect(ports.projectTwin.calls).toEqual([
			{ call: "list", args: [PROJECT, "ada"] },
		]);
	});

	test("refuses while the Project's secrets cannot be reached", async () => {
		const ports = inMemorySecretsPorts();
		ports.unreach("projects");
		await expect(
			listProjectSecrets(ports)(NIGHT_SHIFT, {
				project: PROJECT,
				personId: "ada",
			}),
		).rejects.toThrow("Night Shift could not read this project's secrets now.");
	});
});
