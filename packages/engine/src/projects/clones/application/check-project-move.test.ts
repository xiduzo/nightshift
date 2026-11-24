import { describe, expect, test } from "bun:test";
import { asDate } from "@nightshift/time";
import { HOSTED_ELSEWHERE, PROJECT_NOT_FOUND } from "../../keep";
import { NO_SUCH_SPACE } from "../domain/move";
import { clonesPorts } from "../test-support";
import { checkProjectMove } from "./check-project-move";

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

describe("checkProjectMove", () => {
	test("a Space a Host keeps, a Space that does not exist, a project not in the Space it leaves", async () => {
		const ports = await seeded();
		ports.knownSpaces.known.add("s2");
		await checkProjectMove(ports)({ projectId: "app", from: "s1", to: "s2" });
		await expect(
			checkProjectMove(ports)({ projectId: "app", from: "s1", to: "s3" }),
		).rejects.toThrow(NO_SUCH_SPACE);
		await expect(
			checkProjectMove(ports)({ projectId: "team", from: "s1", to: "s2" }),
		).rejects.toThrow(PROJECT_NOT_FOUND);
		ports.directory.hostElsewhere("s2");
		await expect(
			checkProjectMove(ports)({ projectId: "app", from: "s1", to: "s2" }),
		).rejects.toThrow(HOSTED_ELSEWHERE);
	});
});
