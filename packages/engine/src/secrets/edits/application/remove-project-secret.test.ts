import { describe, expect, test } from "bun:test";
import {
	allowing,
	inMemoryAccess,
} from "../../../access/adapters/out/in-memory-access";
import type { PersonActor } from "../../../contract";
import { inMemorySecretsPorts } from "../../scopes/adapters/out/in-memory-neighbours";
import { removeProjectSecret } from "./remove-project-secret";

const ADA: PersonActor = { personId: "ada", door: "session" };

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
		await removeProjectSecret(ports)(ADA, {
			project: PROJECT,
			name: "TOKEN",
		});
		expect(ports.projectTwin.projects.get("app")?.has("TOKEN")).toBe(false);
		expect(ports.known.projectNamesOf("app").has("TOKEN")).toBe(false);
		// The keeper gets the Person who asks.
		expect(ports.projectTwin.calls.map((c) => c.args.at(-1))).toEqual(
			ports.projectTwin.calls.map(() => "ada"),
		);
		expect(ports.projectTwin.calls).not.toEqual([]);
	});

	test("a refusal of the keeper keeps the name in memory", async () => {
		const ports = inMemorySecretsPorts();
		ports.known.projectNamesOf("app").add("TOKEN");
		ports.projectTwin.fail(new Error("Only a Member who saves flows may."));
		await expect(
			removeProjectSecret(ports)(ADA, {
				project: PROJECT,
				name: "TOKEN",
			}),
		).rejects.toThrow("Only a Member who saves flows may.");
		expect(ports.known.projectNamesOf("app").has("TOKEN")).toBe(true);
	});
});

test("asks flow:save of the Person, before anything else: owners, admins and members may", async () => {
	const access = inMemoryAccess();
	// The other ports are not there: a use of one before the check fails.
	const act = removeProjectSecret({ access } as never);
	expect(
		await access.whoMay("space-1", (actor) =>
			act(actor as PersonActor, { project: { spaceId: "space-1" } } as never),
		),
	).toEqual(allowing("owner", "admin", "member"));
});
