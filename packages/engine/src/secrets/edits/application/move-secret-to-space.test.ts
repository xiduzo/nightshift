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
import { moveSecretToSpace } from "./move-secret-to-space";

const ADA: PersonActor = { personId: "ada", door: "session" };

/** The use case moveSecretToSpace, on in-memory adapters. */

describe("moveSecretToSpace", () => {
	test("saved in the Space first, then this computer's copy goes", async () => {
		const ports = inMemorySecretsPorts();
		ports.computer.values.set("TOKEN", "s3cret");
		ports.facts.saved().set("TOKEN", 1);
		await moveSecretToSpace(ports)(ADA, {
			name: "TOKEN",
			from: "computer",
			spaceId: "space-1",
		});
		expect(ports.projectTwin.spaces.get("space-1")?.get("TOKEN")?.value).toBe(
			"s3cret",
		);
		expect(ports.computer.values.has("TOKEN")).toBe(false);
		// The keeper gets the Person who asks.
		expect(ports.projectTwin.calls.map((c) => c.args.at(-1))).toEqual(
			ports.projectTwin.calls.map(() => "ada"),
		);
		expect(ports.projectTwin.calls).not.toEqual([]);
	});

	test("a refusal of the keeper keeps the Personal copy", async () => {
		const ports = inMemorySecretsPorts();
		ports.personalTwin.secrets.set("TOKEN", { value: "s3cret", setAt: 1 });
		ports.projectTwin.fail(new Error("refused"));
		await expect(
			moveSecretToSpace(ports)(ADA, {
				name: "TOKEN",
				from: "personal",
				spaceId: "space-1",
			}),
		).rejects.toThrow("refused");
		expect(ports.personalTwin.secrets.has("TOKEN")).toBe(true);
	});

	test("refuses a name the scope has no value of", async () => {
		const ports = inMemorySecretsPorts();
		await expect(
			moveSecretToSpace(ports)(ADA, {
				name: "TOKEN",
				from: "personal",
				spaceId: "space-1",
			}),
		).rejects.toThrow("TOKEN is not a Personal secret.");
	});
});

test("only the owner of this computer may, and nothing happens before the check", async () => {
	const computerAccess = inMemoryComputer();
	// The other ports are not there: a use of one before the check fails.
	const act = moveSecretToSpace({ computerAccess } as never);
	expect(
		await computerAccess.whoMay((actor) => act(actor, {} as never)),
	).toEqual(ONLY_THE_OWNER);
});

test("asks flow:save of the Person, before anything else: owners, admins and members may", async () => {
	const access = inMemoryAccess();
	// The other ports are not there: a use of one before the check fails.
	const act = moveSecretToSpace({
		computerAccess: { openComputer: () => {} },
		access,
	} as never);
	expect(
		await access.whoMay("space-1", (actor) =>
			act(actor as PersonActor, { spaceId: "space-1" } as never),
		),
	).toEqual(allowing("owner", "admin", "member"));
});
