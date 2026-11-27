import { expect, test } from "bun:test";
import { runEvents } from "../../testing/run-events";
import type { Parked } from "../state";
import {
	type AnswerPlan,
	CONTINUED,
	GATE_GONE,
	planAnswer,
} from "./answer-plan";
import type { Interrupt, ThreadState } from "./thread";

/**
 * Where an answer to Gate `g` goes: the thread's snapshot x the log beside
 * the Gate x the drive before (`afterPreDrive`). `h` is another Gate on a
 * branch beside it, `s` a step that sleeps beside it.
 */

const gate = (stepId: string): Parked => ({
	kind: "gate",
	stepId,
	nodeId: stepId,
	question: "Ship it?",
	choices: [{ name: "approve" }],
});
const wait = (stepId: string): Parked => ({
	kind: "wait",
	stepId,
	nodeId: stepId,
	reason: "usage-limit",
	until: null,
	message: "",
});
const at = (value: Parked): Interrupt => ({ id: `i-${value.stepId}`, value });

/** The log: `g` waits, and beside it nothing, another Gate, or a sleeper. */
const LOGS = {
	none: () => runEvents().runStarted().stepStarted("g", "g").gateOpened("g"),
	gate: () => LOGS.none().stepStarted("h", "h").gateOpened("h"),
	sleeper: () =>
		LOGS.none().stepStarted("s", "s").waitStarted("s", { until: 400 }),
	/** `g` took an answer, and its wait closed. */
	answered: () =>
		LOGS.none().push(
			"Scored",
			{
				score: "gate_decision",
				value: 1,
				label: "approve",
				by: "person",
				via: "_OTHER",
			},
			{ stepId: "g" },
		),
};
type Log = keyof typeof LOGS;

const sits = (...values: Parked[]): ThreadState => ({
	kind: "interrupted",
	value: values[0] as Parked,
	interrupts: values.map(at),
});
const PENDING: ThreadState = { kind: "pending", next: ["g"] };
const ENDED: ThreadState = { kind: "ended", ended: null };

const VALUE = { kind: "gate", choice: "approve", note: "Yes." } as const;
const RESUME: AnswerPlan = { kind: "resume", value: VALUE };
/** The answer goes to `id`, and each interrupt in `held` keeps waiting. */
const byId = (id: string, ...held: string[]): AnswerPlan => ({
	kind: "resume",
	value: VALUE,
	each: {
		[id]: VALUE,
		...Object.fromEntries(held.map((other) => [other, { kind: "hold" }])),
	},
});
const refuse = (words: string): AnswerPlan => ({ kind: "refuse", words });

type Row = [
	name: string,
	state: ThreadState,
	answered: Parked[],
	log: Log,
	afterPreDrive: boolean,
	plan: AnswerPlan,
];
// biome-ignore format: a table reads one case per line.
const TABLE: Row[] = [
	// The thread took g's answer already (the daemon died before its super-step ended): the drive goes on and holds the rest.
	["answered, nothing beside", PENDING, [gate("g")], "none", false, { kind: "drive-on" }],
	["answered, a sleeper beside", sits(wait("s")), [gate("g")], "sleeper", false, { kind: "drive-on" }],
	["answered, a sleeper in the log only", PENDING, [gate("g")], "sleeper", false, { kind: "drive-on" }],
	["answered, another Gate the thread holds", sits(gate("h")), [gate("g")], "gate", false, { kind: "drive-on" }],
	["answered, another Gate in the log only", PENDING, [gate("g")], "gate", false, { kind: "drive-on" }],
	// The thread does not hold g's interrupt: it goes on to it first.
	["pending", PENDING, [], "none", false, { kind: "pre-drive" }],
	["pending, another Gate beside", PENDING, [], "gate", false, { kind: "pre-drive" }],
	["pending, a sleeper beside", PENDING, [], "sleeper", false, { kind: "pre-drive" }],
	["at another Gate", sits(gate("h")), [], "gate", false, { kind: "pre-drive" }],
	["at a sleeper", sits(wait("s")), [], "sleeper", false, { kind: "pre-drive" }],
	// The thread holds g's interrupt.
	["held alone", sits(gate("g")), [], "none", false, RESUME],
	["held, another Gate beside", sits(gate("g"), gate("h")), [], "gate", false, byId("i-g", "i-h")],
	["held, another Gate in the log only", sits(gate("g")), [], "gate", false, byId("i-g")],
	["held, a sleeper beside", sits(gate("g"), wait("s")), [], "sleeper", false, byId("i-g", "i-s")],
	["held, a sleeper in the log only", sits(gate("g")), [], "sleeper", false, RESUME],
	["a thread that never ran", { kind: "fresh" }, [], "none", false, RESUME],
	["an ended thread", ENDED, [], "none", false, RESUME],
	// After the drive to g's interrupt.
	["after the drive: held", sits(gate("g")), [], "none", true, RESUME],
	["after the drive: held, another Gate beside", sits(gate("g"), gate("h")), [], "gate", true, byId("i-g", "i-h")],
	["after the drive: held, another Gate in the log only", sits(gate("g")), [], "gate", true, byId("i-g")],
	["after the drive: gone with its answer", ENDED, [], "answered", true, refuse(CONTINUED)],
	["after the drive: gone with its answer, at another Gate", sits(gate("h")), [gate("g")], "answered", true, refuse(CONTINUED)],
	["after the drive: gone without an answer", ENDED, [], "none", true, refuse(GATE_GONE)],
	["after the drive: gone without an answer, at another Gate", sits(gate("h")), [], "gate", true, refuse(GATE_GONE)],
	["after the drive: gone without an answer, still pending", PENDING, [], "sleeper", true, refuse(GATE_GONE)],
];

for (const [name, state, answered, log, afterPreDrive, plan] of TABLE)
	test(`an answer to a Gate: ${name}`, () => {
		const snapshot = { state, answered: answered.map(at) };
		const answer = { stepId: "g", choice: "approve", note: "Yes." };
		expect(
			planAnswer(snapshot, LOGS[log]().state(), answer, {
				afterPreDrive: afterPreDrive as false,
			}),
		).toEqual(plan);
	});

test("an answer carries what the deadline chose, the data of a form and where it came from", () => {
	const plan = planAnswer(
		{ state: sits(gate("g")), answered: [] },
		LOGS.none().state(),
		{
			stepId: "g",
			choice: "approve",
			note: "",
			byDeadline: true,
			data: { size: 3 },
			via: "phone",
		},
		{ afterPreDrive: false },
	);
	expect(plan).toEqual({
		kind: "resume",
		value: {
			kind: "gate",
			choice: "approve",
			note: "",
			byDeadline: true,
			data: { size: 3 },
			via: "phone",
		},
	});
});
