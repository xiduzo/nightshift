import { describe, expect, test } from "bun:test";
import { Refusal } from "@nightshift/refusal";
import { allowing } from "../../access/adapters/out/in-memory-access";
import { inMemorySpacesPorts } from "../adapters/out/in-memory-neighbours";
import { USAGE_ON_HOST } from "../domain/policy";
import { setSpaceUsage } from "./set-space-usage";

/** The use case setSpaceUsage, on in-memory adapters. */

const SPACE = "space-1";
const ADA = { personId: "person-ada", door: "session" as const };

describe("setSpaceUsage", () => {
	test("turns usage off and on again in the Space", async () => {
		const ports = inMemorySpacesPorts();
		ports.access.members.join(SPACE, ADA.personId, "admin");
		ports.spacePolicies.add(SPACE);
		await setSpaceUsage(ports)(ADA, { spaceId: SPACE, enabled: false });
		expect(ports.spacePolicies.usageOf(SPACE)).toBe(false);
		await setSpaceUsage(ports)(ADA, { spaceId: SPACE, enabled: true });
		expect(ports.spacePolicies.usageOf(SPACE)).toBe(true);
	});

	test("a Space a Host keeps is refused, and does not change", async () => {
		const ports = inMemorySpacesPorts();
		ports.access.members.join(SPACE, ADA.personId, "admin");
		ports.spacePolicies.hostedElsewhere(SPACE);
		const refusal = await setSpaceUsage(ports)(ADA, {
			spaceId: SPACE,
			enabled: false,
		}).catch((error: unknown) => error);
		expect(refusal).toBeInstanceOf(Refusal);
		expect(refusal).toMatchObject({ kind: "conflict", message: USAGE_ON_HOST });
		expect(ports.spacePolicies.usageOf(SPACE)).toBeUndefined();
	});

	test("owners and admins may, and nobody else", async () => {
		const ports = inMemorySpacesPorts();
		ports.spacePolicies.add(SPACE);
		expect(
			await ports.access.whoMay(
				SPACE,
				(actor) =>
					setSpaceUsage(ports)(actor, { spaceId: SPACE, enabled: false }),
				() => ports.spacePolicies.usageOf(SPACE),
			),
		).toEqual(allowing("owner", "admin"));
	});
});
