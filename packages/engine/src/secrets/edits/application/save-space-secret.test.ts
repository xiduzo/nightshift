import { describe, expect, test } from "bun:test";
import {
	allowing,
	inMemoryAccess,
} from "../../../access/adapters/out/in-memory-access";
import type { PersonActor } from "../../../contract";
import { inMemorySecretsPorts } from "../../scopes/adapters/out/in-memory-neighbours";
import { saveSpaceSecret } from "./save-space-secret";

const ADA: PersonActor = { personId: "ada", door: "session" };

/** The use case saveSpaceSecret, on in-memory adapters. */

describe("saveSpaceSecret", () => {
	test("the keeper saves it as the Person", async () => {
		const ports = inMemorySecretsPorts();
		await saveSpaceSecret(ports)(ADA, {
			spaceId: "space-1",
			name: "TOKEN",
			value: "s3cret",
		});
		expect(ports.projectTwin.spaces.get("space-1")?.get("TOKEN")?.value).toBe(
			"s3cret",
		);
		expect(ports.projectTwin.calls).toEqual([
			{ call: "space.set", args: ["space-1", "TOKEN", "ada"] },
		]);
	});

	test("refuses an empty value before it asks the keeper", async () => {
		const ports = inMemorySecretsPorts();
		await expect(
			saveSpaceSecret(ports)(ADA, {
				spaceId: "space-1",
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
	const act = saveSpaceSecret({ access } as never);
	expect(
		await access.whoMay("space-1", (actor) =>
			act(actor as PersonActor, { spaceId: "space-1" } as never),
		),
	).toEqual(allowing("owner", "admin", "member"));
});
