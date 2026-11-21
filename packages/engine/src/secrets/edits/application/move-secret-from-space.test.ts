import { describe, expect, test } from "bun:test";
import { NIGHT_SHIFT } from "../../../contract";
import { inMemorySecretsPorts } from "../../scopes/adapters/out/in-memory-neighbours";
import { moveSecretFromSpace } from "./move-secret-from-space";

/** The use case moveSecretFromSpace, on in-memory adapters. */

describe("moveSecretFromSpace", () => {
	test("saved as Personal first, then the Space's copy goes", async () => {
		const ports = inMemorySecretsPorts();
		ports.projectTwin.spaces.set(
			"space-1",
			new Map([["TOKEN", { value: "s3cret", setAt: 1 }]]),
		);
		await moveSecretFromSpace(ports)(NIGHT_SHIFT, {
			spaceId: "space-1",
			name: "TOKEN",
			to: "personal",
			personId: "ada",
		});
		expect(ports.personalTwin.secrets.get("TOKEN")?.value).toBe("s3cret");
		expect(ports.projectTwin.calls.map((c) => c.call)).toEqual([
			"space.take",
			"space.remove",
		]);
	});

	test("refuses a name the Space has no secret of", async () => {
		const ports = inMemorySecretsPorts();
		await expect(
			moveSecretFromSpace(ports)(NIGHT_SHIFT, {
				spaceId: "space-1",
				name: "TOKEN",
				to: "computer",
				personId: "ada",
			}),
		).rejects.toThrow("TOKEN is not a secret of this Space.");
	});
});
