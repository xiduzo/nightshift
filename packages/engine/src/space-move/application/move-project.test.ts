import { describe, expect, test } from "bun:test";
import { Refusal } from "@nightshift/refusal";
import { allowing } from "../../access/adapters/out/in-memory-access";
import { NIGHT_SHIFT } from "../../contract";
import { STILL_RUNNING } from "../domain/move";
import { spaceMovePorts } from "../test-support";
import { moveProject } from "./move-project";

/** The use case moveProject, over a database in memory. */

/** `app` in Space `from`, with run r1. Spaces `from` and `to`. */
async function seeded() {
	const ports = await spaceMovePorts();
	for (const id of ["from", "to"]) {
		await ports.rows.space(id);
		ports.projectLookup.spaces.add(id);
	}
	ports.projectLookup.projects.set("app", "from");
	await ports.rows.project({ id: "app", spaceId: "from" });
	await ports.rows.run({
		id: "r1",
		spaceId: "from",
		projectId: "app",
		walkerId: "this-computer",
	});
	ports.projectRuns.runs.set("app", ["r1"]);
	return ports;
}

describe("moveProject", () => {
	test("moves the project and its runs as one Space move under the holds, then logs the move", async () => {
		const ports = await seeded();
		await moveProject(ports)(NIGHT_SHIFT, {
			spaceId: "from",
			projectId: "app",
			toSpaceId: "to",
		});
		expect((await ports.rows.runs())[0]?.spaceId).toBe("to");
		expect((await ports.rows.projects())[0]?.spaceId).toBe("to");
		expect(ports.steps.slice(0, 5)).toEqual([
			"find app",
			"refuse move app",
			"hold schedules",
			"hold starts from",
			"runs of app",
		]);
		expect(ports.steps.at(-1)).toBe("log moved app from to");
	});

	test("a move into a Space that another move holds is refused, and no row moves", async () => {
		const ports = await seeded();
		ports.holds.held.add("to");
		await expect(
			moveProject(ports)(NIGHT_SHIFT, {
				spaceId: "from",
				projectId: "app",
				toSpaceId: "to",
			}),
		).rejects.toThrow("held");
		expect((await ports.rows.projects())[0]?.spaceId).toBe("from");
		expect(ports.steps.slice(-2)).toEqual([
			"release starts from",
			"release schedules",
		]);
	});

	test("a move to its own Space does nothing", async () => {
		const ports = await seeded();
		await moveProject(ports)(NIGHT_SHIFT, {
			spaceId: "from",
			projectId: "app",
			toSpaceId: "from",
		});
		expect(ports.steps).toEqual(["find app"]);
	});

	test("a project that is not in the Space is not found, and nothing moves", async () => {
		const ports = await seeded();
		const refused = await moveProject(ports)(NIGHT_SHIFT, {
			spaceId: "to",
			projectId: "app",
			toSpaceId: "from",
		}).catch((error: unknown) => error);
		expect(refused).toBeInstanceOf(Refusal);
		expect((refused as Refusal).kind).toBe("not-found");
		expect(ports.steps).toEqual(["find app"]);
	});

	test("a Space that does not take the move refuses it before any hold", async () => {
		const ports = await seeded();
		await expect(
			moveProject(ports)(NIGHT_SHIFT, {
				spaceId: "from",
				projectId: "app",
				toSpaceId: "gone",
			}),
		).rejects.toThrow("That Space does not exist.");
		expect(ports.steps).toEqual(["find app", "refuse move app"]);
	});

	test("a run of the project that runs a step refuses the move under the hold: nothing moves, nothing is logged", async () => {
		const ports = await seeded();
		ports.projectRuns.active.add("r1");
		const refused = await moveProject(ports)(NIGHT_SHIFT, {
			spaceId: "from",
			projectId: "app",
			toSpaceId: "to",
		}).catch((error: unknown) => error);
		expect(refused).toBeInstanceOf(Refusal);
		expect((refused as Refusal).kind).toBe("conflict");
		expect((refused as Refusal).message).toBe(STILL_RUNNING);
		expect((await ports.rows.runs())[0]?.spaceId).toBe("from");
		expect(ports.steps).not.toContain("log moved app from to");
		expect(ports.steps.slice(-2)).toEqual([
			"release starts from",
			"release schedules",
		]);
	});

	test("owners and admins of the Space it leaves may, and nobody else", async () => {
		const ports = await seeded();
		for (const person of [
			"a-stranger",
			"the-viewer",
			"the-member",
			"the-admin",
			"the-owner",
		]) {
			ports.access.members.join("to", person, "owner");
		}
		expect(
			await ports.access.whoMay(
				"from",
				(actor) =>
					moveProject(ports)(actor, {
						spaceId: "from",
						projectId: "app",
						toSpaceId: "to",
					}),
				() => ports.steps,
			),
		).toEqual(allowing("owner", "admin"));
	});

	test("owners and admins of the Space it goes to may, and nobody else", async () => {
		const ports = await seeded();
		for (const person of [
			"a-stranger",
			"the-viewer",
			"the-member",
			"the-admin",
			"the-owner",
		]) {
			ports.access.members.join("from", person, "owner");
		}
		expect(
			await ports.access.whoMay(
				"to",
				(actor) =>
					moveProject(ports)(actor, {
						spaceId: "from",
						projectId: "app",
						toSpaceId: "to",
					}),
				() => ports.steps,
			),
		).toEqual(allowing("owner", "admin"));
	});
});
