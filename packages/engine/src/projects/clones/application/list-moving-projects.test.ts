import { describe, expect, test } from "bun:test";
import { asDate } from "@nightshift/time";
import { inMemoryClonesPorts } from "../adapters/out/in-memory-neighbours";
import { listMovingProjects } from "./list-moving-projects";

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

describe("listMovingProjects", () => {
	test("the projects of a Space, removed ones too, with this computer's Clones", async () => {
		const ports = await seeded();
		expect(
			(await listMovingProjects(ports)({ spaceId: "s1" })).map((p) => [
				p.id,
				p.clone,
			]),
		).toEqual([
			["app", true],
			["lib", false],
			["old", true],
		]);
	});
});
