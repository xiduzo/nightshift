import { describe, expect, test } from "bun:test";
import { NIGHT_SHIFT, type OwnDevice } from "../../../contract";
import { inMemoryStartPorts } from "../adapters/out/in-memory-start-ports";
import { listDevices } from "./list-devices";

/** The Devices a person may place a run's steps on, on in-memory adapters. */

const laptop: OwnDevice = {
	deviceId: "laptop",
	name: "Laptop",
	thisDevice: false,
	online: true,
	hasClone: true,
};

function devices() {
	const ports = inMemoryStartPorts();
	ports.planner.offer({ devices: [laptop] });
	return { ports, list: listDevices(ports) };
}

describe("the Devices a person may place a step on", () => {
	test("are the Person's own and others' through Offers, also for one node", async () => {
		const { ports, list } = devices();
		const ada = { personId: "person-ada" };
		expect(
			await list(ada, { spaceId: "space-own", projectId: "project-1" }),
		).toEqual([laptop]);
		const forNode = { type: "agent" } as never;
		await list(ada, { spaceId: "space-own", projectId: "project-1", forNode });
		expect(ports.planner.listed).toEqual([
			{ spaceId: "space-own", personId: "person-ada", projectId: "project-1" },
			{
				spaceId: "space-own",
				personId: "person-ada",
				projectId: "project-1",
				forNode,
			},
		]);
	});

	test("need a Person", async () => {
		const { list } = devices();
		await expect(
			list(NIGHT_SHIFT, { spaceId: "space-own", projectId: "project-1" }),
		).rejects.toMatchObject({
			kind: "signed-out",
			message: "Sign in to see your devices.",
		});
	});

	test("ask the Devices for the Person: the door checked their Membership", async () => {
		const { ports, list } = devices();
		await list(
			{ personId: "person-eve" },
			{ spaceId: "space-own", projectId: "project-1" },
		);
		expect(ports.planner.listed).toEqual([
			{ spaceId: "space-own", personId: "person-eve", projectId: "project-1" },
		]);
	});
});
