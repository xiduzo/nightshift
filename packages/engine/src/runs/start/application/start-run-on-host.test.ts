import { describe, expect, test } from "bun:test";
import { HostUnreachableError } from "../../../contract";
import type { RunSummary } from "../../../read";
import { inMemoryStartPorts } from "../adapters/out/in-memory-start-ports";
import { PinNotHereError } from "../domain/test-run";
import { startRunOnHost } from "./start-run-on-host";

/**
 * The start of a run on the Host that keeps the Space, on in-memory
 * adapters. A test run's pins go as refs (ADR 27): this computer reads
 * them in its own log first, and the Host reads them again in its own.
 */

const NOT_ARRIVED = "The run started. It shows in the run list in a moment.";

/** This computer's log has a run of `project-1` in `space-team` whose `fetch` step ended. */
function onHost() {
	const ports = inMemoryStartPorts();
	ports.runs.seed("run-earlier", {
		run: { projectId: "project-1", spaceId: "space-team" },
		state: {
			test: null,
			steps: new Map([
				[
					"step-1",
					{
						id: "step-1",
						nodeId: "fetch",
						nodeType: "command",
						scope: null,
						endedAt: 1,
						outcome: "pass",
						outputs: { outcome: "pass", log_tail: "fresh", visit: 1 },
						test: null,
					},
				],
			]),
		} as never,
	});
	return { ports, start: startRunOnHost(ports) };
}

describe("a start on the Host", () => {
	test("hands a test run on with its pins as refs, once this computer's log has their outputs", async () => {
		const { ports, start } = onHost();
		const marks = {
			pinned: { fetch: { runId: "run-earlier", stepId: "step-1" } },
			skipped: { approve: "send" },
		};
		await expect(
			start({
				spaceId: "space-team",
				input: { projectId: "project-1", flowName: "watch", test: marks },
			}),
		).rejects.toThrow(NOT_ARRIVED);
		// The outputs stay here: the Host reads them in its own log.
		expect(ports.hosts.started).toEqual([
			{
				projectId: "project-1",
				flowName: "watch",
				test: marks,
				spaceId: "space-team",
			},
		]);
	});

	test("refuses a pin this computer cannot find, and asks the Host nothing", async () => {
		const { ports, start } = onHost();
		const lost = start({
			spaceId: "space-team",
			input: {
				projectId: "project-1",
				flowName: "watch",
				test: { pinned: { fetch: { runId: "run-gone", stepId: "step-1" } } },
			},
		});
		await expect(lost).rejects.toBeInstanceOf(PinNotHereError);
		await expect(lost).rejects.toThrow(
			'Night Shift cannot find the output you pinned on "fetch". Pin a newer output.',
		);
		// A run of another Space is as good as gone.
		await expect(
			start({
				spaceId: "space-other",
				input: {
					projectId: "project-1",
					flowName: "watch",
					test: {
						pinned: { fetch: { runId: "run-earlier", stepId: "step-1" } },
					},
				},
			}),
		).rejects.toBeInstanceOf(PinNotHereError);
		expect(ports.hosts.started).toEqual([]);
	});

	test("a start that pins and skips nothing goes as a plain run", async () => {
		const { ports, start } = onHost();
		await expect(
			start({
				spaceId: "space-team",
				input: { projectId: "project-1", flowName: "watch", test: {} },
			}),
		).rejects.toThrow(NOT_ARRIVED);
		expect(ports.hosts.started).toHaveLength(1);
		expect(ports.hosts.started[0]?.test).toBeUndefined();
	});

	test("gives the run as the run list shows it, once it reached this Replica", async () => {
		const { ports, start } = onHost();
		const shown = { id: "run-on-host-1" } as RunSummary;
		ports.hosts.arrive("run-on-host-1", shown);
		expect(
			await start({
				spaceId: "space-team",
				input: { projectId: "project-1", flowName: "watch" },
			}),
		).toBe(shown);
	});

	test("without a Host to reach, the start is refused", async () => {
		const { ports, start } = onHost();
		ports.hosts.unreachable();
		await expect(
			start({
				spaceId: "space-team",
				input: { projectId: "project-1", flowName: "watch" },
			}),
		).rejects.toBeInstanceOf(HostUnreachableError);
	});
});
