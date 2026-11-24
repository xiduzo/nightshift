import { describe, expect, test } from "bun:test";
import { asDate } from "@nightshift/time";
import { HOSTED_ELSEWHERE } from "../../keep";
import { clonesPorts } from "../test-support";
import { defineProjectWithoutFolder } from "./define-project-without-folder";

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

describe("defineProjectWithoutFolder", () => {
	test("is refused in a Space whose Projects move", async () => {
		const ports = await seeded();
		ports.spaceHolds.held.add("s1");
		await expect(
			defineProjectWithoutFolder(ports)({ spaceId: "s1", name: "Leads" }),
		).rejects.toThrow("held");
		expect(ports.projectLog.facts).toEqual([]);
	});

	test("a new project without a folder each time; refused in a Space a Host keeps", async () => {
		const ports = await seeded();
		expect(
			await defineProjectWithoutFolder(ports)({ spaceId: "s1", name: "Leads" }),
		).toEqual({ projectId: "project-1" });
		expect(
			await defineProjectWithoutFolder(ports)({ spaceId: "s1", name: "Leads" }),
		).toEqual({ projectId: "project-2" });
		expect(
			ports.spaceProjects.documentOf("s1").projects.get("project-1"),
		).toMatchObject({ folder: false, remote: null });
		ports.spaceProjects.hostElsewhere("s2");
		await expect(
			defineProjectWithoutFolder(ports)({ spaceId: "s2", name: "Leads" }),
		).rejects.toThrow(HOSTED_ELSEWHERE);
	});
});
