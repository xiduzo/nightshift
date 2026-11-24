import { describe, expect, test } from "bun:test";
import type { PersonActor } from "@nightshift/engine";
import { inMemoryTargetsPorts } from "../adapters/out/in-memory-neighbours";
import { listScreens } from "./list-screens";
import { listTargets } from "./list-targets";

/** The use case listScreens, on in-memory adapters. */

const ADA: PersonActor = { personId: "ada", door: "session" };
const BOB: PersonActor = { personId: "bob", door: "session" };

describe("listScreens", () => {
	test("the Person's screens as they see them, without the phones whose session ended", async () => {
		const ports = inMemoryTargetsPorts();
		ports.sessions.add("live", "ada", 10_000);
		const phone = {
			personId: "ada",
			kind: "expo" as const,
			name: "Pixel",
			platform: "android",
			keys: null,
			at: 1_000,
		};
		await ports.targetStore.upsert({
			...phone,
			id: "kept",
			endpoint: "ExponentPushToken[a]",
			sessionId: "live",
		});
		await ports.targetStore.upsert({
			...phone,
			id: "ended",
			endpoint: "ExponentPushToken[b]",
			sessionId: "gone",
		});

		expect(await listScreens({ listTargets: listTargets(ports) })(ADA)).toEqual(
			[
				{
					id: "kept",
					kind: "expo",
					name: "Pixel",
					platform: "android",
					createdAt: 1_000,
					lastSeenAt: 1_000,
				},
			],
		);
		expect(ports.targetStore.all().map((t) => t.id)).toEqual(["kept"]);
		expect(await listScreens({ listTargets: listTargets(ports) })(BOB)).toEqual(
			[],
		);
	});
});
