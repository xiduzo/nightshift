import { describe, expect, test } from "bun:test";
import { allowing } from "../../../access/adapters/out/in-memory-access";
import { inMemoryEditingPorts } from "../adapters/out/in-memory-neighbours";
import { resetKeptValue } from "./reset-kept-value";

const ada = { personId: "ada", door: "session" } as const;

describe("resetKeptValue", () => {
	test("forgets the kept value of one variable of the flow", async () => {
		const ports = inMemoryEditingPorts();
		await resetKeptValue(ports)(ada, {
			spaceId: "space",
			projectId: "project",
			flowName: "build",
			name: "count",
		});
		expect(ports.kept.resets).toEqual([
			{
				flow: { spaceId: "space", projectId: "project", flowName: "build" },
				name: "count",
			},
		]);
	});

	test("a project of another Space is not found, and nothing is forgotten", async () => {
		const ports = inMemoryEditingPorts();
		const reset = resetKeptValue(ports)(ada, {
			spaceId: "space",
			projectId: "elsewhere",
			flowName: "build",
			name: "count",
		});
		await expect(reset).rejects.toThrow("This project does not exist.");
		expect(ports.kept.resets).toEqual([]);
	});

	test("asks flow:save: owners, admins and members may, and nobody else", async () => {
		const ports = inMemoryEditingPorts();
		expect(
			await ports.access.whoMay(
				"space",
				(actor) =>
					resetKeptValue(ports)(actor, {
						spaceId: "space",
						projectId: "project",
						flowName: "build",
						name: "count",
					}),
				() => ports.kept.resets,
			),
		).toEqual(allowing("owner", "admin", "member"));
	});
});
