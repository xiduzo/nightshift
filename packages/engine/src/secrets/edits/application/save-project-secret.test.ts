import { describe, expect, test } from "bun:test";
import {
	allowing,
	inMemoryAccess,
} from "../../../access/adapters/out/in-memory-access";
import type { PersonActor } from "../../../contract";
import { inMemorySecretsPorts } from "../../scopes/adapters/out/in-memory-neighbours";
import { saveProjectSecret } from "./save-project-secret";

const ADA: PersonActor = { personId: "ada", door: "session" };

/** The use case saveProjectSecret, on in-memory adapters. */

const PROJECT = { spaceId: "space-1", projectId: "app" };

describe("saveProjectSecret", () => {
	test("the keeper saves it as the Person, and this computer remembers the name", async () => {
		const ports = inMemorySecretsPorts();
		await saveProjectSecret(ports)(ADA, {
			project: PROJECT,
			name: "TOKEN",
			value: "s3cret",
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
			saveProjectSecret(ports)(ADA, {
				project: PROJECT,
				name: "TOKEN",
				value: "",
			}),
		).rejects.toThrow("A secret needs a value.");
		expect(ports.projectTwin.calls).toEqual([]);
	});
});

test("asks flow:save of the Person, before anything else: owners, admins and members may", async () => {
	const access = inMemoryAccess();
	// The other ports are not there: a use of one before the check fails.
	const act = saveProjectSecret({ access } as never);
	expect(
		await access.whoMay("space-1", (actor) =>
			act(actor as PersonActor, { project: { spaceId: "space-1" } } as never),
		),
	).toEqual(allowing("owner", "admin", "member"));
});
