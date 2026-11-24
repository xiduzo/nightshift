import { describe, expect, test } from "bun:test";
import { asDate } from "@nightshift/time";
import { PROJECT_NOT_FOUND } from "../../keep";
import { clonesPorts } from "../test-support";
import { findProject } from "./find-project";

/** `app` in `s1` with a Clone here, `lib` in `s1` without one, `old` removed, `team` in `s2`. */
async function seeded() {
	const ports = await clonesPorts();
	await ports.addProject({
		id: "app",
		spaceId: "s1",
		name: "app",
		remote: "github.com/acme/app",
	});
	await ports.addProject({ id: "lib", spaceId: "s1", name: "lib" });
	await ports.addProject({
		id: "old",
		spaceId: "s1",
		name: "old",
		removedAt: asDate(9),
	});
	await ports.addProject({ id: "team", spaceId: "s2", name: "team" });
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

describe("findProject", () => {
	test("a project a person has not removed, with its folder here or null; another Space's is not found", async () => {
		const ports = await seeded();
		expect(await findProject(ports)({ projectId: "app" })).toMatchObject({
			repoPath: "/work/app",
		});
		expect(
			await findProject(ports)({ projectId: "lib", spaceId: "s1" }),
		).toMatchObject({ repoPath: null });
		await expect(
			findProject(ports)({ projectId: "app", spaceId: "s2" }),
		).rejects.toThrow(PROJECT_NOT_FOUND);
		await expect(findProject(ports)({ projectId: "old" })).rejects.toThrow(
			PROJECT_NOT_FOUND,
		);
	});
});
