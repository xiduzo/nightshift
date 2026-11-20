import { describe, expect, test } from "bun:test";
import type { Actor } from "../../../contract";
import { NO_FOLDER } from "../../keep";
import { inMemoryCatalogPorts } from "../adapters/out/in-memory-neighbours";
import { otherRepository, stillRunning } from "../domain/words";
import { useProjectFolder } from "./use-project-folder";

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

describe("useProjectFolder", () => {
	test("a copy a person has becomes the folder of a project not here yet", async () => {
		const ports = seeded();
		ports.repos.add("/work/mine", "git@github.com:Acme/App.git");
		const used = await useProjectFolder(ports)(ADA, {
			spaceId: "s1",
			projectId: "p1",
			repoPath: "/work/mine",
		});
		expect(used).toMatchObject({ id: "p1", repoPath: "/work/mine" });
		expect(ports.cloneImports.imported).toEqual(["p1"]);
		expect(ports.projectLog.facts.map((f) => f.type)).toEqual(["CloneAdded"]);
	});

	test("a folder of another repository is refused", async () => {
		const ports = seeded();
		ports.repos.add("/work/other", "git@github.com:acme/other.git");
		await expect(
			useProjectFolder(ports)(ADA, {
				spaceId: "s1",
				projectId: "p1",
				repoPath: "/work/other",
			}),
		).rejects.toThrow(otherRepository("github.com/acme/app"));
		expect(ports.store.records.clones).toEqual([]);
	});

	test("refused while a run of the project runs a step in the folder it has", async () => {
		const ports = seeded();
		await ports.store.addClone({
			spaceId: "s1",
			projectId: "p1",
			deviceId: "this-computer",
			path: "/work/app",
		});
		ports.runs.add("r1", "p1");
		ports.runs.activate("r1");
		ports.repos.add("/work/new", "git@github.com:acme/app.git");
		await expect(
			useProjectFolder(ports)(ADA, {
				spaceId: "s1",
				projectId: "p1",
				repoPath: "/work/new",
			}),
		).rejects.toThrow(stillRunning("change its folder"));
	});

	test("a project without a folder never gets one", async () => {
		const ports = inMemoryCatalogPorts();
		ports.store.addProject({
			id: "p1",
			spaceId: "s1",
			name: "feeds",
			folder: false,
		});
		ports.repos.add("/work/feeds");
		await expect(
			useProjectFolder(ports)(ADA, {
				spaceId: "s1",
				projectId: "p1",
				repoPath: "/work/feeds",
			}),
		).rejects.toThrow(NO_FOLDER);
	});
});
