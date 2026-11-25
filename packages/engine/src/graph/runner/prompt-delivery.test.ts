import { afterAll, beforeAll, expect, test } from "bun:test";
import {
	failingScript,
	fakeHarness,
	reportingScript,
	usageLimitScript,
} from "@nightshift/agents/testing";
import type { Flow } from "@nightshift/flows";
import { foldRun } from "../../log";
import { getRunRow } from "../../log/run-row/run-row";
import { parseCalledFlows, parseRunFlow, takesPrompt } from "../../read";
import {
	agent,
	command,
	edge,
	flowOf,
	startRun,
	testRunner,
} from "../../testing/graph";
import {
	createSandbox,
	type Sandbox,
	waitFor,
} from "../../testing/test-support";
import { closeOpenWork } from "./open-work";

/**
 * Where a run is when a person resumes it with a prompt: does the rule that
 * refuses a prompt (`takesPrompt`) say what the walk does? A real runner
 * takes the resume whatever the rule says. A prompt that would reach a
 * session is never refused.
 */

const at = { x: 0, y: 0 };
const T0 = 1_800_000_000_000;
const pass = reportingScript("pass", "Done.");
const no = reportingScript("fail", "No.");
const hang = { steps: [{ type: "wait" as const, ms: 60_000 }] };
/** A usage limit that ends at `seconds` after the start. */
const limit = (seconds: number) => usageLimitScript(T0 + seconds * 1000);
/** A usage limit before the harness names its session. */
const nameless = { ...limit(4), nameless: true as const };
const nap = (seconds: number, id = "nap") => ({
	id,
	type: "wait" as const,
	position: at,
	until: { kind: "duration" as const, minutes: seconds },
});
const a = agent("a", "Do a");
const one = flowOf([a]);
const beside = (other: { id: string }, done: string) =>
	flowOf(
		[
			command("start", "true"),
			a,
			other as never,
			{ id: "joined", type: "join", position: at, wait: "all" },
		],
		[
			edge("1", "start", "pass", "a"),
			edge("2", "start", "pass", other.id),
			edge("3", "a", "pass", "joined"),
			edge("4", other.id, done, "joined"),
		],
	);
const call = (more: object = {}) =>
	flowOf([
		{
			id: "sub",
			type: "call",
			position: at,
			flow: "child",
			inputs: {},
			...more,
		} as never,
	]);
const each = call({
	each: {
		source: { kind: "json", value: '[{"id":"x","title":"x"}]' },
		as: "item",
		branch: "shared",
	},
});
const child = { child: flowOf([a]) };
const eachChild = {
	child: flowOf([a], [], {
		inputs: [{ name: "item", type: "json", required: true }],
	}),
};
/** The second visit of `a` goes on with the session of the first. */
const again = flowOf(
	[agent("a", "Do a", { session: "resume" }), command("k", "true")],
	[
		edge("1", "a", "pass", "k"),
		{ id: "2", from: "k", outcome: "pass", to: "a", max: 1 },
	],
);
const loop = flowOf(
	[a],
	[{ id: "1", from: "a", outcome: "fail", to: "a", max: 1 }],
);

type State = {
	flow: Flow;
	flows?: Record<string, Flow>;
	/** How each call ends. After these: pass. */
	scripts: object[];
	/** What happens once the run is still. */
	cut?: "stop" | "crash";
	/** The rule's verdict, and whether the prompt reached a session. */
	takes: boolean;
	delivered: boolean;
};
const reached = { takes: true, delivered: true };
const nobody = { takes: false, delivered: false };
const STATES: Record<string, State> = {
	"stopped at work": { flow: one, scripts: [hang], cut: "stop", ...reached },
	"crashed at work": { flow: one, scripts: [hang], cut: "crash", ...reached },
	"failed with an error": { flow: one, scripts: [failingScript()], ...reached },
	"failed on its own outcome": { flow: one, scripts: [no], ...reached },
	"failed, its edge at its max": { flow: loop, scripts: [no, no], ...reached },
	"failed on a branch with no edge": {
		flow: beside(command("side", "true"), "pass"),
		scripts: [no],
		...reached,
	},
	asleep: { flow: one, scripts: [limit(4)], ...reached },
	"asleep, then stopped": {
		flow: one,
		scripts: [limit(4)],
		cut: "stop",
		...reached,
	},
	"asleep in an earlier session, its own got no name": {
		flow: again,
		scripts: [pass, nameless],
		...reached,
	},
	"asleep in an earlier session, then stopped": {
		flow: again,
		scripts: [pass, nameless],
		cut: "stop",
		...reached,
	},
	"asleep, no session at all": { flow: one, scripts: [nameless], ...nobody },
	"a loop's second visit stopped": {
		flow: loop,
		scripts: [no, hang],
		cut: "stop",
		...reached,
	},
	"asleep in a called flow": {
		flow: call(),
		flows: child,
		scripts: [limit(4)],
		...reached,
	},
	"asleep in a Call with each": {
		flow: each,
		flows: eachChild,
		scripts: [limit(4)],
		...reached,
	},
	"stopped in a Call with each": {
		flow: each,
		flows: eachChild,
		scripts: [hang],
		cut: "stop",
		...reached,
	},
	"a Wait asleep": { flow: flowOf([nap(4)]), scripts: [], ...nobody },
	"a Command stopped": {
		flow: flowOf([command("c", "sleep 1")]),
		scripts: [],
		cut: "stop",
		...nobody,
	},
	finished: { flow: one, scripts: [], ...reached },
	"finished in a called flow": {
		flow: call(),
		flows: child,
		scripts: [],
		...reached,
	},
	"finished in a Call with each": {
		flow: each,
		flows: eachChild,
		scripts: [],
		...nobody,
	},
	"two sleepers, the Agent wakes first": {
		flow: beside(nap(8), "done"),
		scripts: [limit(4)],
		...reached,
	},
	"two sleepers, the Wait wakes first": {
		flow: beside(nap(4), "done"),
		scripts: [limit(8)],
		...nobody,
	},
};

let sandbox: Sandbox;
beforeAll(async () => {
	sandbox = await createSandbox();
});
afterAll(() => sandbox.cleanup());

for (const [name, state] of Object.entries(STATES)) {
	test(name, async () => {
		let now = T0;
		let calls = 0;
		const fake = fakeHarness(
			(_input, call) => (state.scripts[call] ?? pass) as never,
		);
		const harness: typeof fake = {
			...fake,
			async *run(input) {
				const script = state.scripts[calls++] ?? pass;
				for await (const event of fake.run(input)) {
					if (event.type === "session" && "nameless" in script) continue;
					yield event;
				}
			},
		};
		const h = await startRun(sandbox, state.flow, {
			harness,
			now: () => now,
			...(state.flows ? { flows: state.flows } : {}),
		});
		const daemon = () => testRunner(h, { overdueSweepMs: 3_600_000 });
		let runner = daemon();
		const run = async () => foldRun(await h.events());
		const still = () => waitFor(async () => !runner.isActive(h.runId) || null);
		const ended = async () => {
			await still();
			expect((await run()).status).not.toBe("running");
		};
		await runner.take(h.runId, {
			kind: "start",
			prepare: async () => ({
				row: await getRunRow(sandbox.db, h.runId),
				inputs: {},
				stopAt: null,
			}),
		});
		const works = state.scripts.includes(hang) || state.scripts.length === 0;
		if (state.cut && works) {
			await waitFor(async () => {
				const open = [...(await run()).steps.values()].at(-1);
				if (!open || open.endedAt !== null) return null;
				return (
					open.nodeType === "command" ||
					(calls >= Math.max(1, state.scripts.length) &&
						open.sessions.at(-1)?.harnessSessionId != null) ||
					null
				);
			});
		} else await still();
		if (state.cut === "stop") {
			await runner.take(h.runId, { kind: "stop", by: "person" });
		}
		if (state.cut === "crash") {
			await runner.release();
			await closeOpenWork(
				{
					log: h.log,
					bus: h.deps.shared.bus,
					flowOf: parseRunFlow,
					calledFlowsOf: parseCalledFlows,
				},
				h.runId,
				{ kind: "interrupted", reason: "Night Shift stopped." },
			);
			runner = daemon();
		}
		const verdict = takesPrompt(await run());
		const before = fake.calls.length;
		await runner.take(h.runId, {
			kind: "resume",
			by: "person",
			prompt: "PPP",
		});
		await ended();
		// The other sleepers wake when their time comes.
		for (let i = 0; i < 4 && (await run()).status === "sleeping"; i++) {
			now += 100_000;
			await runner.take(h.runId, { kind: "wake", early: false });
			await still();
		}
		const delivered = fake.calls
			.slice(before)
			.some((c) => c.prompt.includes("PPP") && c.resumeSessionId);
		await runner.release();
		expect({ takes: verdict, delivered }).toEqual({
			takes: state.takes,
			delivered: state.delivered,
		});
	});
}
