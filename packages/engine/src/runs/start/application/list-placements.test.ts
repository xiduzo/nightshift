import { describe, expect, test } from "bun:test";
import { NIGHT_SHIFT, type Placement } from "../../../contract";
import { inMemoryStartPorts } from "../adapters/out/in-memory-start-ports";
import { listPlacements } from "./list-placements";

/** The Devices a person chooses from to start a run, on in-memory adapters. */

const laptop: Placement = {
	deviceId: "laptop",
	name: "Laptop",
	thisDevice: false,
};
const desktop: Placement = {
	deviceId: "desktop",
	name: "Desktop",
	thisDevice: false,
};
const kims: Placement = {
	deviceId: "kims",
	name: "Kim's Mac",
	thisDevice: false,
	offers: ["claude"],
};

function placements() {
	const ports = inMemoryStartPorts();
	ports.access.members.join("space-own", "person-ada", "member");
	return { ports, list: listPlacements(ports) };
}

describe("the Devices a person chooses from", () => {
	test("mark the latest run's Device and the one default a start takes", async () => {
		const { ports, list } = placements();
		ports.planner.offer({ placements: [laptop, desktop, kims] });
		ports.planner.ranOn("project-1", "desktop");
		expect(
			await list(
				{ personId: "person-ada" },
				{ spaceId: "space-own", projectId: "project-1" },
			),
		).toEqual([laptop, { ...desktop, lastRun: true, default: true }, kims]);
		expect(ports.planner.listed).toEqual([
			{ spaceId: "space-own", personId: "person-ada", projectId: "project-1" },
		]);
		ports.planner.offer({ placements: [] });
		expect(
			await list(
				{ personId: "person-ada" },
				{ spaceId: "space-own", projectId: "p" },
			),
		).toEqual([]);
	});

	test("need a Person", async () => {
		const { list } = placements();
		await expect(
			list(NIGHT_SHIFT, { spaceId: "space-own", projectId: "project-1" }),
		).rejects.toMatchObject({
			kind: "signed-out",
			message: "Sign in to start a run.",
		});
	});

	test("need a Member of the Space, and ask nothing for anyone else", async () => {
		const { ports, list } = placements();
		await expect(
			list(
				{ personId: "person-eve", door: "session" },
				{ spaceId: "space-own", projectId: "project-1" },
			),
		).rejects.toMatchObject({
			kind: "not-found",
			message: "That Space does not exist.",
		});
		expect(ports.planner.listed).toEqual([]);
	});
});
