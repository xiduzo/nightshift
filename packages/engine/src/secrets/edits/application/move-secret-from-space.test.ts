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
import { moveSecretFromSpace } from "./move-secret-from-space";

const ADA: PersonActor = { personId: "ada", door: "session" };

/** The use case moveSecretFromSpace, on in-memory adapters. */

describe("moveSecretFromSpace", () => {
	test("saved as Personal first, then the Space's copy goes", async () => {
		const ports = inMemorySecretsPorts();
		ports.projectTwin.spaces.set(
			"space-1",
			new Map([["TOKEN", { value: "s3cret", setAt: 1 }]]),
		);
		await moveSecretFromSpace(ports)(ADA, {
			spaceId: "space-1",
			name: "TOKEN",
			to: "personal",
		});
		expect(ports.personalTwin.secrets.get("TOKEN")?.value).toBe("s3cret");
		expect(ports.projectTwin.calls.map((c) => c.call)).toEqual([
			"space.take",
			"space.remove",
		]);
		// The keeper gets the Person who asks.
		expect(ports.projectTwin.calls.map((c) => c.args.at(-1))).toEqual(
			ports.projectTwin.calls.map(() => "ada"),
		);
		expect(ports.projectTwin.calls).not.toEqual([]);
	});

	test("refuses a name the Space has no secret of", async () => {
		const ports = inMemorySecretsPorts();
		await expect(
			moveSecretFromSpace(ports)(ADA, {
				spaceId: "space-1",
				name: "TOKEN",
				to: "computer",
			}),
		).rejects.toThrow("TOKEN is not a secret of this Space.");
	});
});

test("only the owner of this computer may, and nothing happens before the check", async () => {
	const computerAccess = inMemoryComputer();
	// The other ports are not there: a use of one before the check fails.
	const act = moveSecretFromSpace({ computerAccess } as never);
	expect(
		await computerAccess.whoMay((actor) => act(actor, {} as never)),
	).toEqual(ONLY_THE_OWNER);
});

test("asks flow:save of the Person, before anything else: owners, admins and members may", async () => {
	const access = inMemoryAccess();
	// The other ports are not there: a use of one before the check fails.
	const act = moveSecretFromSpace({
		computerAccess: { openComputer: () => {} },
		access,
	} as never);
	expect(
		await access.whoMay("space-1", (actor) =>
			act(actor as PersonActor, { spaceId: "space-1" } as never),
		),
	).toEqual(allowing("owner", "admin", "member"));
});
