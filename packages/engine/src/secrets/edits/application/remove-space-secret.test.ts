import { describe, expect, test } from "bun:test";
import {
	allowing,
	inMemoryAccess,
} from "../../../access/adapters/out/in-memory-access";
import type { PersonActor } from "../../../contract";
import { inMemorySecretsPorts } from "../../scopes/adapters/out/in-memory-neighbours";
import { removeSpaceSecret } from "./remove-space-secret";

const ADA: PersonActor = { personId: "ada", door: "session" };

/** The use case removeSpaceSecret, on in-memory adapters. */

describe("removeSpaceSecret", () => {
	test("the keeper removes it as the Person", async () => {
		const ports = inMemorySecretsPorts();
		ports.projectTwin.spaces.set(
			"space-1",
			new Map([["TOKEN", { value: "s3cret", setAt: 1 }]]),
		);
		await removeSpaceSecret(ports)(ADA, {
			spaceId: "space-1",
			name: "TOKEN",
		});
		expect(ports.projectTwin.spaces.get("space-1")?.has("TOKEN")).toBe(false);
		expect(ports.projectTwin.calls).toEqual([
			{ call: "space.remove", args: ["space-1", "TOKEN", "ada"] },
		]);
	});
});

test("asks flow:save of the Person, before anything else: owners, admins and members may", async () => {
	const access = inMemoryAccess();
	// The other ports are not there: a use of one before the check fails.
	const act = removeSpaceSecret({ access } as never);
	expect(
		await access.whoMay("space-1", (actor) =>
			act(actor as PersonActor, { spaceId: "space-1" } as never),
		),
	).toEqual(allowing("owner", "admin", "member"));
});
