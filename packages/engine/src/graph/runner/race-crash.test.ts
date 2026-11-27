import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join as joinPath } from "node:path";
import { fakeHarness, reportingScript } from "@nightshift/agents/testing";
import type { AgentSessionInput } from "@nightshift/agents/types";
import type { Flow, FlowNode } from "@nightshift/flows";
import type { LoggedEvent } from "../../log";
import { type Story, type Walked, walkWithFault } from "../../testing/crash";
import { agent, command, edge, flowOf } from "../../testing/graph";
import { createSandbox, type Sandbox } from "../../testing/test-support";

/**
 * A crash at every write of a race (`crash.test.ts` has the model): a
 * `first` Join, and a branch that loses it while its step works. Before
 * each write the daemon dies, and a new daemon recovers the run. The run
 * ends as the walk without a crash, and:
 *
 * - no step of the branch that lost opens again once the winner reached
 *   the Join: the Join's winner is a fact of the log, not of one process
 *   (a step inside a Subflow that opened before may still start, and its
 *   Subflow stops it);
 * - no end of the run says a person stopped it: nobody did.
 *
 * A Subflow that runs past its time budget has the same window: its
 * called flow stops, and the run fails there, never as a person's stop.
 */

let sandbox: Sandbox;
let quiet: ReturnType<typeof spyOn>;
beforeAll(async () => {
	sandbox = await createSandbox();
	// A dying daemon logs what it could not write; that is the point here.
	quiet = spyOn(console, "error").mockImplementation(() => {});
});
afterAll(async () => {
	quiet.mockRestore();
	await sandbox.cleanup();
});

const at = { x: 0, y: 0 };
let walks = 0;

/** An Agent that works for 8 s unless its step stops it. It writes `started` each time it is called. */
const slowHarness = (started: string) =>
	fakeHarness((input: AgentSessionInput) => {
		if (!/Do slow\./.test(input.prompt) && !input.resumeSessionId) {
			return reportingScript("pass", "ok");
		}
		writeFileSync(started, "");
		return { steps: [{ type: "wait", ms: 8_000 }] };
	});

/** The called flow: one Agent that works long. */
const LONG_WORK = flowOf([agent("slow", "Do slow.")]);

/**
 * start → [fast, the losing branch] → joined (first) → after. `fast`
 * reaches the Join only after the work of the losing branch started.
 */
const raceBeside = (started: string, loser: FlowNode): Flow =>
	flowOf(
		[
			command("start", "true"),
			command("fast", `until [ -f '${started}' ]; do sleep 0.02; done`),
			loser,
			{ id: "joined", type: "join", position: at, wait: "first" },
			command("after", "true"),
		],
		[
			edge("s-fast", "start", "pass", "fast"),
			edge("s-loser", "start", "pass", loser.id),
			edge("fast-j", "fast", "pass", "joined"),
			edge("loser-j", loser.id, "pass", "joined"),
			edge("j-after", "joined", "done", "after"),
		],
	);

type Shape = {
	name: string;
	flow(started: string): Flow;
	/** The nodes of the branch that loses, in the run's own flow. */
	loser: string[];
	story: Story;
	/** The statuses a walk ends at. */
	ends: ("finished" | "failed")[];
};

const RACE_STORY: Story = {
	steps: [
		["start", null, "pass"],
		["fast", null, "pass"],
		["joined", null, "done"],
		["after", null, "pass"],
	],
	items: [],
	ended: { status: "finished", reason: null },
};

const SHAPES: Shape[] = [
	{
		name: "an Agent on the branch that loses a first Join",
		flow: (started) => raceBeside(started, agent("slow", "Do slow.")),
		loser: ["slow"],
		story: RACE_STORY,
		ends: ["finished"],
	},
	{
		name: "a Subflow on the branch that loses a first Join",
		flow: (started) =>
			raceBeside(started, {
				id: "sub",
				type: "call",
				position: at,
				flow: "work",
				inputs: {},
			}),
		loser: ["sub"],
		story: RACE_STORY,
		ends: ["finished"],
	},
	{
		name: "a Subflow that runs past its time budget",
		flow: () =>
			flowOf(
				[
					{
						id: "sub",
						type: "call",
						position: at,
						flow: "work",
						inputs: {},
						timeoutMinutes: 1,
					},
					command("after", "true"),
				],
				[edge("pass", "sub", "pass", "after")],
			),
		loser: [],
		story: {
			steps: [["sub", null, "error"]],
			items: [],
			ended: {
				status: "failed",
				reason:
					'Node "sub" failed: The step ran past its time budget of 1 min.',
			},
		},
		ends: ["failed"],
	},
];

/** The steps of `nodes`, in the run's own flow, that opened after the first branch reached the Join. */
function openedAfterWinner(
	events: readonly LoggedEvent[],
	nodes: readonly string[],
): string[] {
	const won = events.findIndex(
		(e) => e.type === "EdgeTaken" && e.payload.to === "joined",
	);
	if (won < 0) return [];
	const nodeOf = new Map<string, string>();
	const opened: string[] = [];
	events.forEach((e, i) => {
		if (e.type === "StepStarted" && e.stepId && !e.payload.scope) {
			nodeOf.set(e.stepId, e.payload.nodeId);
		}
		if (i <= won || !e.stepId) return;
		if (e.type !== "StepStarted" && e.type !== "StepReopened") return;
		const node = nodeOf.get(e.stepId);
		if (node && nodes.includes(node)) opened.push(`${e.type} ${node}`);
	});
	return opened;
}

/** Why the run ended each time, and who stopped it. */
const endReasons = (events: readonly LoggedEvent[]) =>
	events.flatMap((e) => (e.type === "RunEnded" ? [e.payload.endReason] : []));

for (const shape of SHAPES) {
	describe(`a crash at every write: ${shape.name}`, () => {
		const walk = (at: number | null): Promise<Walked> => {
			const started = joinPath(sandbox.dataDir, `started-${++walks}`);
			return walkWithFault(
				sandbox,
				at === null ? null : { at, kind: "crash" },
				shape.flow(started),
				{
					harness: slowHarness(started),
					flows: { work: LONG_WORK },
					ends: shape.ends,
				},
			);
		};
		let writes = 0;

		beforeAll(async () => {
			const clean = await walk(null);
			expect(clean.story).toEqual(shape.story);
			expect(openedAfterWinner(clean.events, shape.loser)).toEqual([]);
			writes = clean.writes;
		}, 60_000);

		test(
			"the run ends as the walk without one; the branch that lost stays stopped, and no person stopped the run",
			async () => {
				expect(writes).toBeGreaterThan(10);
				const wrong: unknown[] = [];
				for (let at = 1; at <= writes; at++) {
					try {
						const { story, events, trace } = await walk(at);
						const opened = openedAfterWinner(events, shape.loser);
						const reasons = endReasons(events);
						if (
							!Bun.deepEquals(story, shape.story) ||
							opened.length > 0 ||
							reasons.includes("stopped_by_person")
						) {
							wrong.push({ at, before: trace[at - 1], story, opened, reasons });
						}
					} catch (error) {
						wrong.push({ at, error: String(error) });
					}
				}
				expect(wrong).toEqual([]);
			},
			{ timeout: 600_000 },
		);
	});
}
