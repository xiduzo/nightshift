import { describe, expect, test } from "bun:test";

import type { Device } from "../device";
import { combineHolds, type RunHolds } from "../graph";
import {
	type EnginePayloads,
	foldRun,
	type LoggedEvent,
	type RunRow,
	type RunState,
	type ServiceSpec,
} from "../log";
import { serviceHolds } from "./holds";
import type { ServiceKeeper } from "./keeper";

/** The services of a run as the engine stops them, over a log and a keeper that only listen. */

const spec: ServiceSpec = {
	start: "docker compose up -d",
	ready: { url: "http://127.0.0.1:8080" },
	everySeconds: 2,
	timeoutMinutes: 5,
	stop: "docker compose down",
	env: {},
};

let seq = 0;
function logged<T extends keyof EnginePayloads>(
	type: T,
	payload: EnginePayloads[T],
): LoggedEvent {
	return {
		seq: ++seq,
		runId: "run-1",
		stepId: null,
		sessionId: null,
		type,
		payload,
		at: seq,
	} as LoggedEvent;
}

const started = (nodeId: string) =>
	logged("ServiceStarted", {
		nodeId,
		scope: null,
		deviceId: "this",
		cwd: "/work",
		logPath: `/logs/${nodeId}.log`,
		pid: 42,
		startedAt: "Sat 31 Oct 22:00:00 2026",
		spec,
	});

const ended = (status: EnginePayloads["RunEnded"]["status"]) =>
	logged("RunEnded", { status, reason: null });

/** A run that started the services `db` and `web`, stopped `db`, then ended. */
function runState(status: EnginePayloads["RunEnded"]["status"]): RunState {
	return foldRun([
		logged("RunStarted", {} as EnginePayloads["RunStarted"]),
		started("db"),
		started("web"),
		logged("ServiceStopped", { nodeId: "db", scope: null, why: "scope" }),
		ended(status),
	]);
}

const device = { id: "this", name: "This computer" } as Device;

function setup(
	status: EnginePayloads["RunEnded"]["status"],
	ready: "ready" | "failed" = "ready",
) {
	const state = runState(status);
	const stopped: string[] = [];
	const broughtUp: string[] = [];
	const appended: { type: string; payload: unknown }[] = [];
	const keeper: Pick<ServiceKeeper, "stop" | "bringUp"> = {
		stop: async (_runId, services) => {
			for (const { service, device: at } of services) {
				stopped.push(`${service.nodeId}@${at?.id ?? "nowhere"}`);
			}
		},
		bringUp: async (input) => {
			broughtUp.push(`${input.nodeId}@${input.device.id}`);
			await input.onStarted({ pid: 43, startedAt: "later" });
			return ready === "ready"
				? { kind: "ready", logTail: "" }
				: { kind: "failed", reason: "Port 8080 is taken.", logTail: "" };
		},
	};
	const holds = serviceHolds({
		keeper,
		log: {
			state: async () => state,
			append: (async (event: { type: string; payload: unknown }) => {
				appended.push(event);
			}) as never,
		},
		deviceOf: async (_runId, deviceId) => (deviceId === "this" ? device : null),
	});
	return { holds, stopped, state, broughtUp, appended };
}

describe("serviceHolds", () => {
	test("given a run that ended, when the engine lets go, then the services it still ran stop on their Device", async () => {
		const { holds, stopped } = setup("failed");

		await holds.ended("run-1", "failed");

		expect(stopped).toEqual(["web@this"]);
	});

	test("given a run the daemon interrupted, when it ends so, then its services wait for recovery", async () => {
		const { holds, stopped } = setup("interrupted");

		await holds.ended("run-1", "interrupted");
		expect(stopped).toEqual([]);

		await holds.notContinuing("run-1");
		expect(stopped).toEqual(["web@this"]);
	});

	test("given a run the daemon interrupted, when it resumes, then what still runs of its services stops, and each starts again", async () => {
		const { holds, stopped, state, broughtUp, appended } = setup("interrupted");

		await holds.resuming({ id: "run-1" } as RunRow, state, {
			nodeId: "test",
			scope: null,
		});

		expect(stopped).toEqual(["web@this"]);
		expect(broughtUp).toEqual(["web@this"]);
		expect(appended).toEqual([
			{
				type: "ServiceStarted",
				runId: "run-1",
				payload: expect.objectContaining({
					nodeId: "web",
					pid: 43,
					startedAt: "later",
					again: true,
				}),
			} as never,
		]);
	});

	test("given a run that failed, when a person resumes it, then its services start again without a second stop", async () => {
		const { holds, stopped, state, broughtUp } = setup("failed");

		await holds.resuming({ id: "run-1" } as RunRow, state, {
			nodeId: "test",
			scope: null,
		});

		expect(stopped).toEqual([]);
		expect(broughtUp).toEqual(["web@this"]);
	});

	test("given a service that does not get ready again, when the run resumes, then the resume is refused with the reason", async () => {
		const { holds, state } = setup("failed", "failed");

		await expect(
			holds.resuming({ id: "run-1" } as RunRow, state, {
				nodeId: "test",
				scope: null,
			}),
		).rejects.toThrow(
			'The service "web" did not start again. Port 8080 is taken.',
		);
	});
});

describe("combineHolds", () => {
	test("given a part that refuses the resume, then the parts before it let go again", async () => {
		const calls: string[] = [];
		const part = (name: string, refuses = false): RunHolds => ({
			ended: async (_runId, status) => {
				calls.push(`${name} ended ${status}`);
			},
			notContinuing: async () => {},
			resuming: async () => {
				calls.push(`${name} resuming`);
				if (refuses) throw new Error(`${name} refuses`);
			},
		});
		const holds = combineHolds([part("leases"), part("services", true)]);

		await expect(
			holds.resuming({ id: "run-1" } as RunRow, runState("stopped"), {
				nodeId: "test",
				scope: null,
			}),
		).rejects.toThrow("services refuses");

		expect(calls).toEqual([
			"leases resuming",
			"services resuming",
			"leases ended stopped",
		]);
	});
});
