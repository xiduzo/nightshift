import { describe, expect, test } from "bun:test";
import type { FlowNode } from "@nightshift/flows";
import type { Device } from "../device";
import {
	fallbackKey,
	foldRun,
	type RunFallbacks,
	type RunLog,
	type RunRow,
} from "../log";
import type { EngineEventType, EventInput } from "../log/events";
import { testDevice } from "../testing/test-support";

type Appended = EventInput<EngineEventType>;

import { createPlacement } from "./placement";

/**
 * Placement while a run walks, over a fake port: the plan read from the
 * row (a node's profile's Device, else its `device`, else the run's, by
 * id and with the plan's names), the Device working for the run (ADR 13),
 * where a moved step goes on, and the move itself (ADR 17): to the first
 * fallback that can take the step now, with `StepMoved` and the warning.
 */

const A = "device-a";
const B = "device-b";
const H = "device-h";
const SPACE = "space-1";
const PROJECT = "project-1";

/** What each Device was asked, with the run the call named. */
type Call = { at: string; kind: string; input: Record<string, unknown> };

/** A Device of the port: online or not, with what it has, and it records what it is asked. */
function fakeDevice(
	id: string,
	name: string,
	calls: Call[],
	options: { online?: boolean; harnesses?: Record<string, never> } = {},
): Device {
	const device = testDevice({ harnesses: options.harnesses ?? {} }, id);
	const seen =
		(kind: string) =>
		(input: Record<string, unknown>): never => {
			calls.push({ at: id, kind, input });
			throw new Error(`${kind} is not run in this test`);
		};
	return {
		...device,
		name,
		state: async () => ({ online: options.online ?? true }),
		session: seen("session") as unknown as Device["session"],
		exec: seen("exec") as unknown as Device["exec"],
		callTool: seen("callTool") as unknown as Device["callTool"],
		decide: seen("decide") as unknown as Device["decide"],
	};
}

/** The port over `devices`: a Device by id, named as the plan says or as asked. */
function portOf(devices: Record<string, Device>) {
	return {
		deviceById: (id: string, _run: unknown, name?: string): Device => {
			const device = devices[id];
			if (!device) throw new Error(`no device ${id}`);
			return name === undefined ? device : { ...device, name };
		},
	};
}

/** A run row as its plan keeps it: on B, with H named by a node. */
function row(fields: Partial<RunRow> = {}): RunRow {
	return {
		id: "run-1",
		spaceId: SPACE,
		projectId: PROJECT,
		walkerId: A,
		deviceId: B,
		placements: JSON.stringify({ [H]: H }),
		deviceNames: JSON.stringify({ [B]: "studio-b", [H]: "hetzner-1" }),
		startedBy: "ada",
		fallbacks: null,
		worktreePath: "/work/run-1",
		branch: "nightshift/run-1",
		...fields,
	} as RunRow;
}

const command = (id: string, extra: object = {}): FlowNode =>
	({
		id,
		type: "command",
		position: { x: 0, y: 0 },
		command: "true",
		...extra,
	}) as FlowNode;

const agentOn = (device: string, profile = "builder", extra: object = {}) =>
	({
		id: "work",
		type: "agent",
		position: { x: 0, y: 0 },
		prompt: "Work.",
		profile: { device, profile },
		...extra,
	}) as FlowNode;

const RUN = { spaceId: SPACE, projectId: PROJECT, runId: "run-1" };

function placementOver(
	calls: Call[],
	online: Partial<Record<string, boolean>> = {},
	harnesses: Partial<Record<string, Record<string, never>>> = {},
) {
	const at = (id: string, name: string) =>
		fakeDevice(id, name, calls, {
			online: online[id] ?? true,
			...(harnesses[id] ? { harnesses: harnesses[id] } : {}),
		});
	return createPlacement({
		device: { id: A },
		devices: portOf({
			[A]: at(A, "here"),
			[B]: at(B, "B as the port names it"),
			[H]: at(H, "H as the port names it"),
		}),
	});
}

describe("the Device of a step, from the plan alone", () => {
	test("names each Device as the plan does, with no warm-up", () => {
		const placement = placementOver([]);
		expect(placement.deviceFor(command("x"), row()).name).toBe("studio-b");
		expect(placement.deviceFor(command("y", { device: H }), row()).name).toBe(
			"hetzner-1",
		);
		expect(placement.deviceById(H, row()).name).toBe("hetzner-1");
	});

	test("a run from before ids: its node names its Device by the name the plan keeps (ADR 14)", () => {
		const placement = placementOver([]);
		const older = row({ placements: JSON.stringify({ "hetzner-1": H }) });
		// Its flow snapshot reads as format 8: the name is to choose again.
		const at = placement.deviceFor(
			command("y", { device: { name: "hetzner-1" } }),
			older,
		);
		expect([at.id, at.name]).toEqual([H, "hetzner-1"]);
	});

	test("a run from before the plan kept names: by the node's name, and before Placement on its Walker", () => {
		const placement = placementOver([]);
		const older = row({
			placements: JSON.stringify({ "hetzner-1": H }),
			deviceNames: null,
		});
		const named = placement.deviceFor(
			command("y", { device: { name: "hetzner-1" } }),
			older,
		);
		expect([named.id, named.name]).toEqual([H, "hetzner-1"]);
		expect(placement.deviceFor(command("x"), older).id).toBe(B);
		expect(
			placement.deviceFor(
				command("x"),
				row({ deviceId: null, placements: null, deviceNames: null }),
			).id,
		).toBe(A);
	});

	test("a node with a profile runs on its profile's Device by id: two Devices of one name keep their own steps", () => {
		const calls: Call[] = [];
		const twin = (id: string) => fakeDevice(id, "twin", calls);
		const placement = createPlacement({
			device: { id: A },
			devices: portOf({
				[A]: fakeDevice(A, "here", calls),
				"twin-a": twin("twin-a"),
				"twin-b": twin("twin-b"),
			}),
		});
		const twins = row({
			placements: null,
			deviceNames: JSON.stringify({
				[B]: "studio-b",
				"twin-a": "twin",
				"twin-b": "twin",
			}),
		});
		const first = placement.deviceFor(agentOn("twin-a"), twins);
		const second = placement.deviceFor(agentOn("twin-b"), twins);
		expect([first.id, first.name]).toEqual(["twin-a", "twin"]);
		expect([second.id, second.name]).toEqual(["twin-b", "twin"]);
		expect(placement.deviceFor(agentOn(A), twins).id).toBe(A);
	});

	test("a run planned before steps were placed by id still reads: its copy names the profile's Device by name too", () => {
		const placement = placementOver([]);
		const older = row({ placements: JSON.stringify({ "hetzner-1": H }) });
		const at = placement.deviceFor(
			agentOn(H, "builder", { device: { name: "hetzner-1" } }),
			older,
		);
		expect([at.id, at.name]).toEqual([H, "hetzner-1"]);
	});

	test("whether the run's worktree is here: the run's Device is this computer, or its Walker", () => {
		const placement = placementOver([]);
		expect(placement.placedHere(row())).toBe(false);
		expect(placement.placedHere(row({ deviceId: A }))).toBe(true);
		expect(placement.placedHere(row({ deviceId: null }))).toBe(true);
	});
});

describe("a Device works for the run", () => {
	test("each session, command, tool call and decision names the run (ADR 13)", async () => {
		const calls: Call[] = [];
		const placement = placementOver(calls);
		const signal = new AbortController().signal;
		const device = placement.deviceFor(command("x"), row());
		const byId = placement.deviceById(H, row());
		const asks: (() => unknown)[] = [
			() => device.exec({ command: "true", cwd: "/work", signal }),
			() => device.session({ prompt: "Work." } as never),
			() => byId.callTool({ connection: "c", tool: "t" } as never),
			() => byId.decide({ prompt: "?" } as never),
		];
		for (const ask of asks) {
			try {
				await ask();
			} catch {
				// The fakes record the call and run nothing.
			}
		}
		expect(calls.map((c) => [c.at, c.kind, c.input.run])).toEqual([
			[B, "exec", RUN],
			[B, "session", RUN],
			[H, "callTool", RUN],
			[H, "decide", RUN],
		]);
	});
});

describe("a step that moved", () => {
	const fallbacks: RunFallbacks = {
		run: [{ id: A, name: "here" }],
		nodes: {
			[fallbackKey(agentOn(B))]: [
				{
					id: H,
					name: "hetzner-1",
					profile: { device: H, profile: "p2" },
					fields: { harness: "codex", model: "o3" },
				},
			],
		},
	};

	test("goes on where it moved to, with the values of the backup's profile, whether or not its first Device is back", async () => {
		const calls: Call[] = [];
		const placement = placementOver(calls, { [H]: false });
		const moved = placement.deviceFor(
			agentOn(B),
			row({ fallbacks: JSON.stringify(fallbacks) }),
			H,
		);
		expect([moved.id, moved.name]).toEqual([H, "hetzner-1"]);
		await Promise.resolve()
			.then(() =>
				moved.session({ prompt: "Work.", harness: "claude-code" } as never),
			)
			.catch(() => {});
		expect(calls).toEqual([
			{
				at: H,
				kind: "session",
				input: { prompt: "Work.", harness: "codex", model: "o3", run: RUN },
			},
		]);
	});

	test("a step without a Device of its own goes by the run's fallbacks", () => {
		const placement = placementOver([]);
		const moved = placement.deviceFor(
			command("x"),
			row({ fallbacks: JSON.stringify(fallbacks) }),
			A,
		);
		expect([moved.id, moved.name]).toEqual([A, "here"]);
	});
});

describe("the move of a step whose Device is offline (ADR 17)", () => {
	/** A log that keeps what is appended; the run has no events. */
	function logOf() {
		const appended: Appended[] = [];
		const log = {
			append: async (event: Appended) => {
				appended.push(event);
				return event;
			},
			state: async () => foldRun([]),
		} as unknown as Pick<RunLog, "append" | "state">;
		return { log, appended };
	}

	const planned = (fallbacks: RunFallbacks) =>
		row({ fallbacks: JSON.stringify(fallbacks) });

	const move = (
		placement: ReturnType<typeof createPlacement>,
		run: RunRow,
		node: FlowNode,
		more: { hasSession?: boolean; inWorktree?: boolean } = {},
	) => {
		const { log, appended } = logOf();
		const from = placement.deviceFor(node, run);
		return placement
			.moveStep({
				log,
				node,
				run,
				stepId: "step-1",
				from,
				hasSession: more.hasSession ?? false,
				inWorktree: more.inWorktree ?? false,
			})
			.then((to) => ({ to, appended }));
	};

	test("to the first fallback that can take it now: one that is offline, or lacks what the step needs, is passed over", async () => {
		const run = planned({
			run: [
				{ id: H, name: "hetzner-1" },
				{ id: A, name: "here" },
			],
			nodes: {},
		});
		const placement = placementOver([], { [B]: false, [H]: false });
		const { to, appended } = await move(placement, run, command("x"));
		expect(to?.id).toBe(A);
		expect(appended.map((e) => ({ type: e.type, payload: e.payload }))).toEqual(
			[
				{ type: "StepMoved", payload: { from: B, to: A } },
				{
					type: "RunWarned",
					payload: {
						kind: "device-fallback",
						message:
							"studio-b is offline. here takes over this step. Space and project secrets work there. Secrets saved only on another computer do not.",
					},
				},
			],
		);

		// Nobody has a Codex harness: the step waits for B.
		const codex = agentOn(B, "builder", { harness: "codex" });
		const noFit = await move(
			placementOver([], { [B]: false }),
			planned({
				run: [],
				nodes: {
					[fallbackKey(codex)]: [
						{ id: A, name: "here", profile: { device: A, profile: "p" } },
					],
				},
			}),
			codex,
		);
		expect(noFit.to).toBeNull();
		expect(noFit.appended).toEqual([]);
	});

	test("to the Host: the warning says Personal secrets do not work there", async () => {
		const run = planned({
			run: [{ id: H, name: "hetzner-1" }],
			nodes: {},
			hostId: H,
		});
		const { to, appended } = await move(
			placementOver([], { [B]: false }),
			run,
			command("x"),
		);
		expect(to?.id).toBe(H);
		expect(appended[1]?.payload).toEqual({
			kind: "device-fallback",
			message:
				"studio-b is offline. hetzner-1 takes over this step. Space and project secrets work there. Personal secrets and secrets saved on another computer do not.",
		});
	});

	test("stays when it has a session to continue, or when the run's work is only on its offline Device", async () => {
		const run = planned({ run: [{ id: A, name: "here" }], nodes: {} });
		const placement = placementOver([], { [B]: false });
		expect(
			(await move(placement, run, command("x"), { hasSession: true })).to,
		).toBeNull();
		// The run's work is on B, which is offline: a step in the worktree stays.
		expect(
			(await move(placement, run, command("x"), { inWorktree: true })).to,
		).toBeNull();
		// A step that needs a computer, not the worktree, moves.
		expect((await move(placement, run, command("x"))).to?.id).toBe(A);
	});
});
