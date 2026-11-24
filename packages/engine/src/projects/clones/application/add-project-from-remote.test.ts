import { describe, expect, test } from "bun:test";
import { asDate } from "@nightshift/time";
import { HOSTED_ELSEWHERE } from "../../keep";
import { inMemoryClonesPorts } from "../adapters/out/in-memory-neighbours";
import { addProjectFromRemote } from "./add-project-from-remote";

/** `app` in `s1` with a Clone here, `lib` in `s1` without one, `old` removed, `team` in `s2`. */
async function seeded() {
	const ports = inMemoryClonesPorts();
	ports.store.addProject({
		id: "app",
		spaceId: "s1",
		name: "app",
		remote: "github.com/acme/app",
	});
	ports.store.addProject({ id: "lib", spaceId: "s1", name: "lib" });
	ports.store.addProject({
		id: "old",
		spaceId: "s1",
		name: "old",
		removedAt: asDate(9),
	});
	ports.store.addProject({ id: "team", spaceId: "s2", name: "team" });
	await ports.store.addClone({
		spaceId: "s1",
		projectId: "app",
		deviceId: "this-computer",
		path: "/work/app",
	});
	await ports.store.addClone({
		spaceId: "s1",
		projectId: "old",
		deviceId: "this-computer",
		path: "/work/old",
	});
	return ports;
}

describe("addProjectFromRemote", () => {
	test("a new project without a Clone here, the same one again, a removed one back", async () => {
		const ports = await seeded();
		const request = {
			spaceId: "s1",
			name: "site",
			remote: "github.com/acme/site",
		};
		const first = await addProjectFromRemote(ports)(request);
		expect(first).toEqual({ projectId: "project-1" });
		expect(await addProjectFromRemote(ports)(request)).toEqual(first);
		expect(ports.projectLog.facts.map((f) => f.type)).toEqual(["ProjectAdded"]);
		ports.store.addProject({
			id: "gone",
			spaceId: "s1",
			name: "gone",
			remote: "github.com/acme/gone",
			removedAt: asDate(3),
		});
		expect(
			await addProjectFromRemote(ports)({
				spaceId: "s1",
				name: "gone",
				remote: "github.com/acme/gone",
			}),
		).toEqual({ projectId: "gone" });
		expect(ports.projectLog.facts.map((f) => f.type)).toEqual([
			"ProjectAdded",
			"ProjectRestored",
		]);
		ports.spaceProjects.hostElsewhere("s2");
		await expect(
			addProjectFromRemote(ports)({
				spaceId: "s2",
				name: "x",
				remote: "github.com/acme/x",
			}),
		).rejects.toThrow(HOSTED_ELSEWHERE);
	});

	test("a remote that is a project of another Space is refused", async () => {
		const ports = await seeded();
		await expect(
			addProjectFromRemote(ports)({
				spaceId: "s2",
				name: "app",
				remote: "github.com/acme/app",
			}),
		).rejects.toThrow("another Space");
	});
});
