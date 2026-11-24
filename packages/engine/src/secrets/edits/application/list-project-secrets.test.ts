import { describe, expect, test } from "bun:test";
import {
	allowing,
	inMemoryAccess,
} from "../../../access/adapters/out/in-memory-access";
import type { PersonActor } from "../../../contract";
import { inMemorySecretsPorts } from "../../scopes/adapters/out/in-memory-neighbours";
import { listProjectSecrets } from "./list-project-secrets";

const ADA: PersonActor = { personId: "ada", door: "session" };

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
		const listed = await listProjectSecrets(ports)(ADA, {
			project: PROJECT,
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
			listProjectSecrets(ports)(ADA, {
				project: PROJECT,
			}),
		).rejects.toThrow("Night Shift could not read this project's secrets now.");
	});
});

test("every Member of the Space may, whatever the role, and nobody else", async () => {
	const access = inMemoryAccess();
	// The other ports are not there: a use of one before the check fails.
	const act = listProjectSecrets({ access } as never);
	expect(
		await access.whoMay("space-1", (actor) =>
			act(actor as PersonActor, { project: { spaceId: "space-1" } } as never),
		),
	).toEqual(allowing("owner", "admin", "member", "viewer"));
});
