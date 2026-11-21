import { describe, expect, test } from "bun:test";
import { NIGHT_SHIFT } from "../../../contract";
import { inMemorySecretsPorts } from "../../scopes/adapters/out/in-memory-neighbours";
import { removeSpaceSecret } from "./remove-space-secret";

/** The use case removeSpaceSecret, on in-memory adapters. */

describe("removeSpaceSecret", () => {
	test("the keeper removes it as the Person", async () => {
		const ports = inMemorySecretsPorts();
		ports.projectTwin.spaces.set(
			"space-1",
			new Map([["TOKEN", { value: "s3cret", setAt: 1 }]]),
		);
		await removeSpaceSecret(ports)(NIGHT_SHIFT, {
			spaceId: "space-1",
			name: "TOKEN",
			personId: "ada",
		});
		expect(ports.projectTwin.spaces.get("space-1")?.has("TOKEN")).toBe(false);
		expect(ports.projectTwin.calls).toEqual([
			{ call: "space.remove", args: ["space-1", "TOKEN", "ada"] },
		]);
	});
});
