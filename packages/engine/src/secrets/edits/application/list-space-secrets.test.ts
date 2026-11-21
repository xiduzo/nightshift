import { describe, expect, test } from "bun:test";
import { NIGHT_SHIFT } from "../../../contract";
import { inMemorySecretsPorts } from "../../scopes/adapters/out/in-memory-neighbours";
import { listSpaceSecrets } from "./list-space-secrets";

/** The use case listSpaceSecrets, on in-memory adapters. */

describe("listSpaceSecrets", () => {
	test("the keeper's names of the Space for the Person, never a value", async () => {
		const ports = inMemorySecretsPorts();
		ports.projectTwin.spaces.set(
			"space-1",
			new Map([["TOKEN", { value: "space-value", setAt: 3 }]]),
		);
		const listed = await listSpaceSecrets(ports)(NIGHT_SHIFT, {
			spaceId: "space-1",
			personId: "ada",
		});
		expect(listed).toEqual([{ name: "TOKEN", setAt: 3, setBy: null }]);
		expect(JSON.stringify(listed)).not.toContain("space-value");
	});

	test("refuses while the Space's secrets cannot be reached", async () => {
		const ports = inMemorySecretsPorts();
		ports.unreach("projects");
		await expect(
			listSpaceSecrets(ports)(NIGHT_SHIFT, {
				spaceId: "space-1",
				personId: "ada",
			}),
		).rejects.toThrow("Night Shift could not read this project's secrets now.");
	});
});
