import { describe, expect, test } from "bun:test";
import type { Actor } from "../../../contract";
import { PROJECT_NOT_FOUND } from "../../keep";
import { inMemoryCatalogPorts } from "../adapters/out/in-memory-neighbours";
import { renameProject } from "./rename-project";

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

describe("renameProject", () => {
	test("a new name in the Space document, and its fact; the same name again changes nothing", async () => {
		const ports = seeded();
		const renamed = await renameProject(ports)(ADA, {
			spaceId: "s1",
			projectId: "p1",
			name: "App",
		});
		expect(renamed.id).toBe("p1");
		expect(ports.spaceProjects.documentOf("s1").projects.get("p1")?.name).toBe(
			"App",
		);
		expect(ports.projectLog.facts).toEqual([
			{ type: "ProjectRenamed", payload: { projectId: "p1", name: "App" } },
		]);
		await renameProject(ports)(ADA, {
			spaceId: "s1",
			projectId: "p1",
			name: "app",
		});
		expect(ports.projectLog.facts).toHaveLength(2);
	});

	test("a project of another Space is not found", async () => {
		const ports = seeded();
		await expect(
			renameProject(ports)(ADA, { spaceId: "s2", projectId: "p1", name: "x" }),
		).rejects.toThrow(PROJECT_NOT_FOUND);
		expect(ports.projectLog.facts).toEqual([]);
	});
});
