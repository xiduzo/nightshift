import { describe, expect, test } from "bun:test";
import type { Actor } from "../../../contract";
import { NOT_ON_THIS_COMPUTER, PROJECT_NOT_FOUND } from "../../keep";
import { inMemoryCatalogPorts } from "../adapters/out/in-memory-neighbours";
import { listBranches } from "./list-branches";

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

describe("listBranches", () => {
	test("the branches of the folder here", async () => {
		const ports = seeded();
		ports.repos.add("/work/app", "git@github.com:acme/app.git");
		await ports.store.addClone({
			spaceId: "s1",
			projectId: "p1",
			deviceId: "this-computer",
			path: "/work/app",
		});
		expect(
			await listBranches(ports)(ADA, { spaceId: "s1", projectId: "p1" }),
		).toEqual({ current: "main", local: ["main"], remote: [] });
	});

	test("none for a project without a folder; refused for one not on this computer or not in the Space", async () => {
		const ports = seeded();
		ports.store.addProject({
			id: "p2",
			spaceId: "s1",
			name: "feeds",
			folder: false,
		});
		expect(
			await listBranches(ports)(ADA, { spaceId: "s1", projectId: "p2" }),
		).toEqual({ current: null, local: [], remote: [] });
		await expect(
			listBranches(ports)(ADA, { spaceId: "s1", projectId: "p1" }),
		).rejects.toThrow(NOT_ON_THIS_COMPUTER);
		await expect(
			listBranches(ports)(ADA, { spaceId: "s2", projectId: "p1" }),
		).rejects.toThrow(PROJECT_NOT_FOUND);
	});
});
