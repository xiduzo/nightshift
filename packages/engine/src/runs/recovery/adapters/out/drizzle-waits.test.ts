import { beforeEach, describe, expect, test } from "bun:test";
import type { EnginePayloads } from "../../../../log";
import { type EventSpec, FAR, HERE, recoveryGround } from "../../test-support";
import { drizzleWaits } from "./drizzle-waits";

/** A run a test adds: with the wait its step `s1` started, and whether that wait ended. */
type Added = {
	id: string;
	projectId: "project-1" | "project-2";
	here: boolean;
	wait?: { reason: "signal" | "lease" | "device-offline"; signal?: string };
	woke?: boolean;
};

/** The log of an added run: started, its step `s1` started, and then its wait and its wake. */
function logOf(added: Added): EventSpec[] {
	const events: EventSpec[] = [
		{
			type: "RunStarted",
			payload: {
				projectId: added.projectId,
				flowName: null,
				title: "t",
				start: "a",
			} as EnginePayloads["RunStarted"],
		},
		{
			type: "StepStarted",
			stepId: "s1",
			payload: {
				nodeId: "a",
				nodeType: "wait",
				visit: 1,
				transcriptPath: "/t/s1",
				logPath: null,
				scope: null,
			},
		},
	];
	if (added.wait) {
		events.push({
			type: "WaitStarted",
			stepId: "s1",
			payload: {
				reason: added.wait.reason,
				until: null,
				message: "It waits.",
				since: 1,
				...(added.wait.signal ? { signal: added.wait.signal } : {}),
			},
		});
	}
	if (added.woke) {
		events.push({
			type: "WaitEnded",
			stepId: "s1",
			payload: {
				early: true,
				...(added.wait?.signal ? { signal: added.wait.signal } : {}),
			},
		});
	}
	return events;
}

const make = async () => {
	const { deps, addRun } = await recoveryGround();
	return {
		waits: drizzleWaits(deps),
		add: (added: Added) =>
			addRun(added.id, logOf(added), {
				projectId: added.projectId,
				walkerId: added.here ? HERE : FAR,
			}),
	};
};

describe("Waits over drizzle", () => {
	let under: Awaited<ReturnType<typeof make>>;
	beforeEach(async () => {
		under = await make();
	});

	test("sleeping gives the sleep of each run this computer walks, and null for a run that does not sleep", async () => {
		await under.add({
			id: "run-lease",
			projectId: "project-1",
			here: true,
			wait: { reason: "lease" },
		});
		await under.add({ id: "run-busy", projectId: "project-1", here: true });
		await under.add({
			id: "run-far",
			projectId: "project-1",
			here: false,
			wait: { reason: "lease" },
		});
		const sleeping = await under.waits.sleeping();
		expect([...sleeping.keys()].sort()).toEqual(["run-busy", "run-lease"]);
		expect(sleeping.get("run-lease")).toMatchObject({
			stepId: "s1",
			reason: "lease",
		});
		expect(sleeping.get("run-busy")).toBeNull();
	});

	test("waitedFor gives the runs of that project here that waited for a signal of that name", async () => {
		const deployed = { reason: "signal" as const, signal: "deployed" };
		await under.add({
			id: "run-1",
			projectId: "project-1",
			here: true,
			wait: deployed,
		});
		await under.add({
			id: "run-other-name",
			projectId: "project-1",
			here: true,
			wait: { reason: "signal", signal: "merged" },
		});
		await under.add({
			id: "run-other-project",
			projectId: "project-2",
			here: true,
			wait: deployed,
		});
		await under.add({
			id: "run-far",
			projectId: "project-1",
			here: false,
			wait: deployed,
		});
		expect(await under.waits.waitedFor("project-1", "deployed")).toEqual([
			"run-1",
		]);
	});

	test("waitedFor keeps a run that waited once and moved on: its log says so", async () => {
		await under.add({
			id: "run-1",
			projectId: "project-1",
			here: true,
			wait: { reason: "signal", signal: "deployed" },
			woke: true,
		});
		expect(await under.waits.waitedFor("project-1", "deployed")).toEqual([
			"run-1",
		]);
		expect((await under.waits.sleeping()).get("run-1")).toBeNull();
	});
});
