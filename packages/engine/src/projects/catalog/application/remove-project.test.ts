import { describe, expect, test } from "bun:test";
import { allowing } from "../../../access/adapters/out/in-memory-access";
import type { Actor } from "../../../contract";
import { inMemoryCatalogPorts } from "../adapters/out/in-memory-neighbours";
import { SLEEPS, stillRunning, WAITS_AT_GATE } from "../domain/words";
import { removeProject } from "./remove-project";

const ADA: Actor = { personId: "person-ada", door: "session" };

/** A project of the Space `s1`, as another Device's Clone brought it. */
function seeded() {
	const ports = inMemoryCatalogPorts();
	ports.store.addProject({
		id: "p1",
		spaceId: "s1",
		name: "app",
		remote: "github.com/acme/app",
	});
	return ports;
}

describe("removeProject", () => {
	test("marks the project removed in its Space document, and its fact", async () => {
		const ports = seeded();
		await removeProject(ports)(ADA, { spaceId: "s1", projectId: "p1" });
		expect(
			ports.spaceProjects.documentOf("s1").projects.get("p1")?.removedAt,
		).not.toBeNull();
		expect(ports.projectLog.facts).toEqual([
			{ type: "ProjectRemoved", payload: { projectId: "p1" } },
		]);
	});

	test("refused while a run of it runs a step, waits at a Gate or sleeps", async () => {
		for (const [status, active, words] of [
			["running", true, stillRunning("remove the project")],
			["waiting", false, WAITS_AT_GATE],
			["sleeping", false, SLEEPS],
		] as const) {
			const ports = seeded();
			ports.runs.add("r1", "p1", status);
			if (active) ports.runs.activate("r1");
			await expect(
				removeProject(ports)(ADA, { spaceId: "s1", projectId: "p1" }),
			).rejects.toThrow(words);
			expect(ports.projectLog.facts).toEqual([]);
		}
	});

	test("owners and admins may, and nobody else", async () => {
		const ports = seeded();
		expect(
			await ports.access.whoMay(
				"s1",
				(actor) =>
					removeProject(ports)(actor, { spaceId: "s1", projectId: "p1" }),
				() => ports.projectLog.facts,
			),
		).toEqual(allowing("owner", "admin"));
	});
});
