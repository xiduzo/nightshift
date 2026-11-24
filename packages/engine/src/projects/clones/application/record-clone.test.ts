import { describe, expect, test } from "bun:test";
import { asDate } from "@nightshift/time";
import { NO_FOLDER, PROJECT_NOT_FOUND } from "../../keep";
import { clonesPorts } from "../test-support";
import { recordClone } from "./record-clone";

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

describe("recordClone", () => {
	test("records another Device's Clone, and refuses a project the document lacks, one without a folder and a Space a Host keeps", async () => {
		const ports = await seeded();
		const studio = (projectId: string) => ({
			projectId,
			deviceId: "studio",
			deviceName: "Studio",
		});
		await ports.spaceProjects.create("s1", "app", {
			name: "app",
			remote: null,
			folder: true,
		});
		await ports.spaceProjects.create("s1", "notes", {
			name: "notes",
			remote: null,
			folder: false,
		});
		await recordClone(ports)({ spaceId: "s1", clone: studio("app") });
		expect(ports.spaceProjects.documentOf("s1").clones).toEqual([
			{ projectId: "app", deviceId: "studio" },
		]);
		await expect(
			recordClone(ports)({ spaceId: "s1", clone: studio("none") }),
		).rejects.toThrow(PROJECT_NOT_FOUND);
		await expect(
			recordClone(ports)({ spaceId: "s1", clone: studio("notes") }),
		).rejects.toThrow(NO_FOLDER);
		ports.spaceProjects.hostElsewhere("s2");
		await expect(
			recordClone(ports)({ spaceId: "s2", clone: studio("team") }),
		).rejects.toThrow(PROJECT_NOT_FOUND);
	});
});
