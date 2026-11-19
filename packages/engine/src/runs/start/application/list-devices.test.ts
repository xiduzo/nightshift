import { describe, expect, test } from "bun:test";
import { NIGHT_SHIFT, type OwnDevice } from "../../../contract";
import { inMemoryStartPorts } from "../adapters/out/in-memory-start-ports";
import { listDevices } from "./list-devices";

/** The Devices a person may place a run's steps on, on in-memory adapters. */

/** What access says of a Space the Person is not a Member of. */
const NO_SPACE = { kind: "not-found", message: "That Space does not exist." };

const laptop: OwnDevice = {
	deviceId: "laptop",
	name: "Laptop",
	thisDevice: false,
	online: true,
	hasClone: true,
};

function devices() {
	const ports = inMemoryStartPorts();
	ports.access.members.join("space-own", "person-ada", "viewer");
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

	test("need a Member of the Space", async () => {
		const { ports, list } = devices();
		await expect(
			list(
				{ personId: "person-eve" },
				{ spaceId: "space-own", projectId: "project-1" },
			),
		).rejects.toMatchObject(NO_SPACE);
		expect(ports.planner.listed).toEqual([]);
	});
});
