import type { Flow, FlowNodeType } from "@nightshift/flows";
import type { RunResult, RunStatus } from "../../../run-status";

/**
 * The runs as the dashboard reads them: the fields of a run's summary and
 * its detail that its numbers use, and no more. The read model (`read/`)
 * writes them. `dashboard/inputs.test.ts` holds both sides to one meaning.
 */

/** Why a run needed you. */
export const NEEDED_YOU_REASONS = [
	"gate",
	"ask",
	"resumed",
	"stopped",
	"took-over",
] as const;
export type NeededYouReason = (typeof NEEDED_YOU_REASONS)[number];

/** One time a person stepped in. `planned`: the flow draws this Gate or Ask for a person. */
export type NeededYou = {
	reason: NeededYouReason;
	at: number;
	planned?: boolean;
	nodeId?: string;
	question?: string;
};

/** Whether a step-in was planned. An older Host does not say: its Gates and Asks count as planned. */
export function isPlanned(act: NeededYou): boolean {
	return act.planned ?? (act.reason === "gate" || act.reason === "ask");
}

/** Whether a run with this status is still open: at work, waiting at a Gate, or asleep. */
export function isOpenStatus(status: RunStatus): boolean {
	return status === "running" || status === "waiting" || status === "sleeping";
}

/** The two ladders, where a climb landed, and who landed it (`read/ladder.ts`). */
export type Ladder = "work" | "choice";
export type Rung = "rule" | "first" | "later" | "person" | "deadline" | "none";
export type RungBy = "rule" | "model" | "agent" | "flow" | "person";

/** The landings of a run per node, rung and tier. */
export type RunRung = {
	ladder: Ladder;
	nodeId: string;
	via?: string;
	rung: Rung;
	by: RungBy;
	tier: string | null;
	landed: number;
	costUsd: number;
	costEstimated: boolean;
	costMissing: number;
	picked?: number;
	unsure?: number;
};

/** One score of a run. `by`: who chose a Gate's option. */
export type RunScore = {
	score: string;
	value: number;
	label: string | null;
	stepId: string | null;
	at: number;
	by: "person" | "deadline" | null;
};

/** A run as the dashboard reads it. */
export type RunIn = {
	id: string;
	projectId: string;
	flowName: string | null;
	title: string;
	branch: string;
	trigger: { kind: "manual" } | { kind: "schedule" | "webhook"; at: number };
	status: RunStatus;
	reason: string | null;
	endReason?: string | null;
	result: RunResult | null;
	wakeAt: number | null;
	stopAt: number | null;
	createdAt: number;
	endedAt: number | null;
	costUsd: number;
	costEstimated: boolean;
	costMissing: number;
	costCalls: number;
	warnings: {
		kind: string;
		message: string;
		nodeId: string | null;
		at: number;
	}[];
	subflows: {
		flowName: string;
		status: RunStatus;
		costUsd: number;
		costEstimated: boolean;
		costMissing: number;
		costCalls: number;
		startedAt: number;
		endedAt: number | null;
	}[];
	gates: {
		openedAt: number;
		closedAt: number | null;
		answeredBy: "person" | "deadline" | null;
	}[];
	neededYou?: NeededYou[];
	report?: { stepId: string; excerpt: string; more: boolean };
	sleeps?: { from: number; to: number | null }[];
	metrics?: {
		wallMs: number | null;
		agentMs: number;
		gateWaitMs: number;
		tokens: {
			input: number;
			output: number;
			cacheRead: number;
			cacheWrite: number;
		};
		scores?: RunScore[];
		ladder?: RunRung[];
	};
	test?: { pinned: string[]; skipped: string[] };
};

/** A run with its steps, as the next changes to try read it. */
export type RunDetailIn = RunIn & { flow: Flow; steps: StepIn[] };

/** One step of a run, as the next changes to try read it. `outcome`: a node's outcome, or a reserved end. */
export type StepIn = {
	nodeId: string;
	nodeType: FlowNodeType;
	visit: number;
	endedAt: number | null;
	outcome: string | null;
	outputs: Record<string, unknown>;
	error: string | null;
	scope: { parentStepId: string; itemId: string | null } | null;
	costUsd: number;
	gate: { openedAt: number; deadline: unknown } | null;
};

/** One revision of a flow, as its changes read it (`flows/flow-document.ts`). */
export type RevisionIn = {
	at: number;
	kind: "save" | "restore" | "import" | "merge" | "copy" | "upgrade" | "infer";
	changes: {
		added: number;
		removed: number;
		changed: number;
		edges: number;
		other: number;
		empty: boolean;
	} | null;
};
