import { describe, expect, test } from "bun:test";
import { asDate } from "@nightshift/time";
import { allowing } from "../../../access/adapters/out/in-memory-access";
import type { Actor } from "../../../contract";
import { catalogPorts } from "../test-support";
import { listProjects } from "./list-projects";

const ADA: Actor = { personId: "person-ada", door: "session" };

describe("listProjects", () => {
	test("the projects of the Space a person has not removed, oldest first, with their Clones, this computer first", async () => {
		const ports = await catalogPorts();
		await ports.addProject({ id: "a", spaceId: "s1", name: "a" });
		await ports.addProject({ id: "b", spaceId: "s1", name: "b" });
		await ports.addProject({ id: "c", spaceId: "s2", name: "c" });
		await ports.addProject({
			id: "d",
			spaceId: "s1",
			name: "d",
			removedAt: asDate(5),
		});
		await ports.store.addClone({
			spaceId: "s1",
			projectId: "a",
			deviceId: "this-computer",
			path: "/a",
		});
		await ports.spaceProjects.recordCloneHere("s1", {
			projectId: "a",
			deviceId: "studio",
			deviceName: "Studio",
		});

		const listed = await listProjects(ports)(ADA, { spaceId: "s1" });
		expect(listed.map((p) => p.id)).toEqual(["a", "b"]);
		expect(listed[0]?.clones).toEqual([
			{ deviceId: "this-computer", deviceName: null, thisDevice: true },
			{ deviceId: "studio", deviceName: "Studio", thisDevice: false },
		]);
		expect(listed[1]).toMatchObject({ repoPath: null, clones: [] });
	});

	test("every Member of the Space may, whatever the role, and nobody else", async () => {
		const ports = await catalogPorts();
		expect(
			await ports.access.whoMay("s1", (actor) =>
				listProjects(ports)(actor, { spaceId: "s1" }),
			),
		).toEqual(allowing("owner", "admin", "member", "viewer"));
	});
});
