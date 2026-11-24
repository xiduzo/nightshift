import { describe, expect, test } from "bun:test";
import type { Refusal } from "@nightshift/refusal";
import { NIGHT_SHIFT } from "../../contract";
import { inMemoryAccess } from "../adapters/out/in-memory-access";
import { SpaceNotFound } from "../domain/refusals";
import { openSpace } from "./open-space";

/** Opening a Space for an actor, on in-memory adapters. */

const SPACE = "space-1";
const ADA = { personId: "person-ada", door: "session" as const };

/** What a request refuses with, or null. */
const refusalOf = (work: Promise<unknown>) =>
	work.then(
		() => null,
		(error: unknown) => error,
	);

describe("openSpace", () => {
	test("Night Shift acts in every Space", async () => {
		const ports = inMemoryAccess();
		await openSpace(ports)(NIGHT_SHIFT, {
			spaceId: SPACE,
			need: { run: ["start"] },
		});
	});

	test("a Person who is not a Member does not find the Space", async () => {
		const ports = inMemoryAccess();
		ports.members.join("space-2", ADA.personId, "owner");
		const refused = await refusalOf(openSpace(ports)(ADA, { spaceId: SPACE }));
		expect(refused).toBeInstanceOf(SpaceNotFound);
		expect((refused as Refusal).kind).toBe("not-found");
		expect((refused as Refusal).message).toBe("That Space does not exist.");
	});

	test("a Member whose role does not allow the need is refused, in the words of a role", async () => {
		const ports = inMemoryAccess();
		ports.members.join(SPACE, ADA.personId, "viewer");
		await openSpace(ports)(ADA, { spaceId: SPACE });
		const refused = await refusalOf(
			openSpace(ports)(ADA, { spaceId: SPACE, need: { run: ["start"] } }),
		);
		expect(refused).toBeInstanceOf(ports.RoleRefusal);
		expect((refused as Refusal).kind).toBe("forbidden");
		expect((refused as Refusal).message).toBe(
			"Your role in this Space does not allow this.",
		);
	});

	test("a Member whose role allows the need acts", async () => {
		const ports = inMemoryAccess();
		ports.members.join(SPACE, ADA.personId, "member");
		expect(
			await openSpace(ports)(ADA, {
				spaceId: SPACE,
				need: { run: ["start"] },
			}),
		).toBeUndefined();
	});
});
