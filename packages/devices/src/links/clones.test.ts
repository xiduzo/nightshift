import { afterEach, beforeEach, expect, test } from "bun:test";
import { clone } from "@nightshift/db/schema";
import { NIGHT_SHIFT } from "@nightshift/engine";
import { createSandbox, type Sandbox } from "@nightshift/engine/testing";
import { Refusal } from "@nightshift/refusal";
import { eq } from "drizzle-orm";
import type { HostClient } from "../contract";
import { partialHostClient } from "../testing";
import { type PairedReplicas, pairedReplicas } from "../testing/paired";
import { tellClones } from "./clones";

let a: Sandbox;
let b: Sandbox;
let paired: PairedReplicas;
beforeEach(async () => {
	[a, b] = await Promise.all([createSandbox(), createSandbox()]);
	paired = await pairedReplicas(a, b);
});
afterEach(async () => {
	await Promise.all([a.cleanup(), b.cleanup()]);
});

/** Tells the Host once, as a link that comes online and drops again does. */
async function tellOnce(client: HostClient = paired.memory.client(paired.key)) {
	const online = new AbortController();
	const told = tellClones({
		spaces: async () => [a.spaceId],
		projects: paired.device.projects,
		deviceName: async () => "B",
	})(client, online.signal);
	// It says it, then waits while the link is online.
	await Bun.sleep(50);
	online.abort();
	await told;
}

const devicesWithClone = async (projectId: string) =>
	(await paired.host.projects.clones(a.spaceId, projectId)).map(
		(c) => c.deviceId,
	);

test("a Clone the Host missed heals when the link comes online, and one the Device no longer has goes", async () => {
	const { id: projectId } = await paired.host
		.space(a.spaceId, NIGHT_SHIFT)
		.addProject({ repoPath: a.repoPath });
	await paired.projectOnDevice(projectId, { clone: true });
	expect(await devicesWithClone(projectId)).toContain(b.deviceId);

	// The Host lost it (an addClone that never landed).
	await paired.host.projects.forgetDevice(b.deviceId);
	expect(await devicesWithClone(projectId)).not.toContain(b.deviceId);
	await tellOnce();
	expect(await devicesWithClone(projectId)).toContain(b.deviceId);

	// Again: nothing changes.
	await tellOnce();
	expect(
		(await devicesWithClone(projectId)).filter((id) => id === b.deviceId),
	).toHaveLength(1);

	// The Device no longer has its folder.
	await b.db.delete(clone).where(eq(clone.deviceId, b.deviceId));
	await tellOnce();
	expect(await devicesWithClone(projectId)).not.toContain(b.deviceId);
});

test("a Space where the person may not add projects is left alone; another failure throws, for the link to try again", async () => {
	// The Host's answers come as the link hands them out: in this computer's words.
	const forbidden = partialHostClient({
		sync: {
			setClones: () =>
				Promise.reject(
					new Refusal("forbidden", "Your role does not add projects."),
				),
		},
	});
	await tellOnce(forbidden);

	const failing = partialHostClient({
		sync: {
			setClones: () => Promise.reject(new TypeError("Unable to connect.")),
		},
	});
	await expect(
		tellClones({
			spaces: async () => [a.spaceId],
			projects: paired.device.projects,
			deviceName: async () => "B",
		})(failing, new AbortController().signal),
	).rejects.toThrow("Unable to connect.");
});

test("says whether it is a development install, and the computer's fingerprint when it has one", async () => {
	const told: { dev: boolean; machine?: string | undefined }[] = [];
	const client = partialHostClient({
		sync: {
			setClones: async (input: { dev: boolean; machine?: string }) => {
				told.push({ dev: input.dev, machine: input.machine });
				return { added: [], removed: [] };
			},
		},
	});
	for (const machine of ["a".repeat(64), null]) {
		const online = new AbortController();
		const said = tellClones({
			spaces: async () => [a.spaceId],
			projects: paired.device.projects,
			deviceName: async () => "B",
			...(machine ? { dev: true } : {}),
			machine,
		})(client, online.signal);
		await Bun.sleep(20);
		online.abort();
		await said;
	}
	expect(told).toEqual([
		{ dev: true, machine: "a".repeat(64) },
		{ dev: false, machine: undefined },
	]);
});
