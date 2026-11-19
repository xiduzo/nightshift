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
	ports.access.members.join("space-own", "person-ada", "member");
	ports.planner.offer({ devices: [laptop] });
	return { ports, list: listDevices(ports) };
}

describe("the Devices a person may place a step on", () => {
	test("are the Person's own and others' through Offers, also for one node", async () => {
		const { ports, list } = devices();
		const ada = { personId: "person-ada", door: "session" as const };
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

	test("need a Member of the Space, and ask nothing for anyone else", async () => {
		const { ports, list } = devices();
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
