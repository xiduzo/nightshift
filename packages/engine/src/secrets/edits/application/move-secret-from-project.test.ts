import { describe, expect, test } from "bun:test";
import {
	allowing,
	inMemoryAccess,
} from "../../../access/adapters/out/in-memory-access";
import {
	inMemoryComputer,
	ONLY_THE_OWNER,
} from "../../../access/computer/adapters/out/in-memory-computer";
import type { PersonActor } from "../../../contract";
import { inMemorySecretsPorts } from "../../scopes/adapters/out/in-memory-neighbours";
import { moveSecretFromProject } from "./move-secret-from-project";

const ADA: PersonActor = { personId: "ada", door: "session" };

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
		await moveSecretFromProject(ports)(ADA, {
			project: PROJECT,
			name: "TOKEN",
			to: "computer",
		});
		expect(ports.computer.values.get("TOKEN")).toBe("s3cret");
		expect(ports.projectTwin.calls.map((c) => c.call)).toEqual([
			"take",
			"remove",
		]);
		expect(ports.known.projectNamesOf("app").has("TOKEN")).toBe(false);
		// The keeper gets the Person who asks.
		expect(ports.projectTwin.calls.map((c) => c.args.at(-1))).toEqual(
			ports.projectTwin.calls.map(() => "ada"),
		);
		expect(ports.projectTwin.calls).not.toEqual([]);
	});

	test("a failure in the new scope keeps the Project's copy", async () => {
		const ports = inMemorySecretsPorts();
		ports.projectTwin.projects.set(
			"app",
			new Map([["TOKEN", { value: "s3cret", setAt: 1 }]]),
		);
		ports.personalTwin.fail(new Error("offline"));
		await expect(
			moveSecretFromProject(ports)(ADA, {
				project: PROJECT,
				name: "TOKEN",
				to: "personal",
			}),
		).rejects.toThrow("offline");
		expect(ports.projectTwin.projects.get("app")?.has("TOKEN")).toBe(true);
	});

	test("refuses a name the Project has no secret of", async () => {
		const ports = inMemorySecretsPorts();
		await expect(
			moveSecretFromProject(ports)(ADA, {
				project: PROJECT,
				name: "TOKEN",
				to: "computer",
			}),
		).rejects.toThrow("TOKEN is not a secret of this project.");
	});
});

test("only the owner of this computer may, and nothing happens before the check", async () => {
	const computerAccess = inMemoryComputer();
	// The other ports are not there: a use of one before the check fails.
	const act = moveSecretFromProject({ computerAccess } as never);
	expect(
		await computerAccess.whoMay((actor) =>
			act(actor, { project: {} } as never),
		),
	).toEqual(ONLY_THE_OWNER);
});

test("asks flow:save of the Person, before anything else: owners, admins and members may", async () => {
	const access = inMemoryAccess();
	// The other ports are not there: a use of one before the check fails.
	const act = moveSecretFromProject({
		computerAccess: { openComputer: () => {} },
		access,
	} as never);
	expect(
		await access.whoMay("space-1", (actor) =>
			act(actor as PersonActor, { project: { spaceId: "space-1" } } as never),
		),
	).toEqual(allowing("owner", "admin", "member"));
});
