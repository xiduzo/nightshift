import { describe, expect, test } from "bun:test";
import { NIGHT_SHIFT } from "../../../contract";
import { inMemorySecretsPorts } from "../../scopes/adapters/out/in-memory-neighbours";
import { moveSecretToProject } from "./move-secret-to-project";

/** The use case moveSecretToProject, on in-memory adapters. */

const PROJECT = { spaceId: "space-1", projectId: "app" };

describe("moveSecretToProject", () => {
	test("from this computer: saved in the Project first, then this computer's copy goes", async () => {
		const ports = inMemorySecretsPorts();
		ports.computer.values.set("TOKEN", "s3cret");
		ports.facts.saved().set("TOKEN", 1);
		await moveSecretToProject(ports)(NIGHT_SHIFT, {
			name: "TOKEN",
			from: "computer",
			project: PROJECT,
			personId: "ada",
		});
		expect(ports.projectTwin.projects.get("app")?.get("TOKEN")?.value).toBe(
			"s3cret",
		);
		expect(ports.computer.values.has("TOKEN")).toBe(false);
		expect(ports.known.projectNamesOf("app").has("TOKEN")).toBe(true);
	});

	test("from Personal: the Personal copy goes after the Project has it", async () => {
		const ports = inMemorySecretsPorts();
		ports.personalTwin.secrets.set("TOKEN", { value: "s3cret", setAt: 1 });
		await moveSecretToProject(ports)(NIGHT_SHIFT, {
			name: "TOKEN",
			from: "personal",
			project: PROJECT,
			personId: "ada",
		});
		expect(ports.personalTwin.secrets.has("TOKEN")).toBe(false);
		expect(ports.projectTwin.projects.get("app")?.has("TOKEN")).toBe(true);
	});

	test("a refusal of the keeper keeps this computer's copy", async () => {
		const ports = inMemorySecretsPorts();
		ports.computer.values.set("TOKEN", "s3cret");
		ports.facts.saved().set("TOKEN", 1);
		ports.projectTwin.fail(new Error("refused"));
		await expect(
			moveSecretToProject(ports)(NIGHT_SHIFT, {
				name: "TOKEN",
				from: "computer",
				project: PROJECT,
				personId: "ada",
			}),
		).rejects.toThrow("refused");
		expect(ports.computer.values.get("TOKEN")).toBe("s3cret");
	});

	test("refuses a name the scope has no value of", async () => {
		const ports = inMemorySecretsPorts();
		const move = moveSecretToProject(ports);
		await expect(
			move(NIGHT_SHIFT, {
				name: "TOKEN",
				from: "computer",
				project: PROJECT,
				personId: "ada",
			}),
		).rejects.toThrow("This computer has no saved value of TOKEN.");
		await expect(
			move(NIGHT_SHIFT, {
				name: "TOKEN",
				from: "personal",
				project: PROJECT,
				personId: "ada",
			}),
		).rejects.toThrow("TOKEN is not a Personal secret.");
	});
});
