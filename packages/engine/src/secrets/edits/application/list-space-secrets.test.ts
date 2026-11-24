import { describe, expect, test } from "bun:test";
import {
	allowing,
	inMemoryAccess,
} from "../../../access/adapters/out/in-memory-access";
import type { PersonActor } from "../../../contract";
import { inMemorySecretsPorts } from "../../scopes/adapters/out/in-memory-neighbours";
import { listSpaceSecrets } from "./list-space-secrets";

const ADA: PersonActor = { personId: "ada", door: "session" };

/** The use case listSpaceSecrets, on in-memory adapters. */

describe("listSpaceSecrets", () => {
	test("the keeper's names of the Space for the Person, never a value", async () => {
		const ports = inMemorySecretsPorts();
		ports.projectTwin.spaces.set(
			"space-1",
			new Map([["TOKEN", { value: "space-value", setAt: 3 }]]),
		);
		const listed = await listSpaceSecrets(ports)(ADA, {
			spaceId: "space-1",
		});
		expect(listed).toEqual([{ name: "TOKEN", setAt: 3, setBy: null }]);
		expect(JSON.stringify(listed)).not.toContain("space-value");
		// The keeper gets the Person who asks.
		expect(ports.projectTwin.calls.map((c) => c.args.at(-1))).toEqual(
			ports.projectTwin.calls.map(() => "ada"),
		);
		expect(ports.projectTwin.calls).not.toEqual([]);
	});

	test("refuses while the Space's secrets cannot be reached", async () => {
		const ports = inMemorySecretsPorts();
		ports.unreach("projects");
		await expect(
			listSpaceSecrets(ports)(ADA, {
				spaceId: "space-1",
			}),
		).rejects.toThrow("Night Shift could not read this project's secrets now.");
	});
});

test("every Member of the Space may, whatever the role, and nobody else", async () => {
	const access = inMemoryAccess();
	// The other ports are not there: a use of one before the check fails.
	const act = listSpaceSecrets({ access } as never);
	expect(
		await access.whoMay("space-1", (actor) =>
			act(actor as PersonActor, { spaceId: "space-1" } as never),
		),
	).toEqual(allowing("owner", "admin", "member", "viewer"));
});
