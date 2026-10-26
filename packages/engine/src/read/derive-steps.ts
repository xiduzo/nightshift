import type { AgentHarnessName } from "@nightshift/agents/types";
import type {
	FlowNodeType,
	ItemState,
	JsonValue,
	NodeOutputs,
} from "@nightshift/flows";
import {
	type EngineEventType,
	type EnginePayloads,
	type GateChoice,
	type GateDeadline,
	type InputValues,
	type ItemFacts,
	type LoggedEvent,
	type Scope,
	type StepOutcome,
	type StepOutputs,
	scopeKey,
} from "../log";
import {
	addCost,
	type CostTally,
	NO_COST,
	sessionCost,
	stepEndCost,
} from "./cost";

/**
 * Pure projections of a run's event log onto its steps: sessions, items,
 * node outputs, variables, visits and cost. Nothing here is stored: the
 * log is the only source.
 */

export type EventOf<T extends EngineEventType> = Extract<
	LoggedEvent,
	{ type: T }
>;

export function ofType<T extends EngineEventType>(
	events: readonly LoggedEvent[],
	type: T,
): EventOf<T>[] {
	return events.filter((e): e is EventOf<T> => e.type === type);
}

export function bySeq(events: readonly LoggedEvent[]): LoggedEvent[] {
	return [...events].sort((a, b) => a.seq - b.seq);
}

export type DerivedSession = {
	id: string;
	stepId: string | null;
	prompt: string;
	resumeSessionId: string | null;
	harness: AgentHarnessName;
	harnessSessionId: string | null;
	startedAt: number;
	startSeq: number;
	/** The first end wins: a late duplicate never rewrites history. */
	ending: EnginePayloads["SessionEnded"] | null;
	/** The last running total (`SessionUsage`), or null. */
	spent: EnginePayloads["SessionUsage"] | null;
};

/** Sessions in the order they started. */
export function deriveSessions(
	events: readonly LoggedEvent[],
): DerivedSession[] {
	const sessions = new Map<string, DerivedSession>();
	for (const e of bySeq(events)) {
		if (!e.sessionId) continue;
		if (e.type === "SessionStarted") {
			sessions.set(e.sessionId, {
				id: e.sessionId,
				stepId: e.stepId,
				prompt: e.payload.prompt,
				resumeSessionId: e.payload.resumeSessionId,
				harness: e.payload.harness ?? "claude-code",
				harnessSessionId: null,
				startedAt: e.at,
				startSeq: e.seq,
				ending: null,
				spent: null,
			});
			continue;
		}
		const session = sessions.get(e.sessionId);
		if (!session) continue;
		if (e.type === "HarnessSessionAssigned") {
			session.harnessSessionId ??= e.payload.harnessSessionId;
		} else if (e.type === "SessionUsage") {
			session.spent = e.payload;
		} else if (e.type === "SessionEnded") {
			session.ending ??= e.payload;
		}
	}
	return [...sessions.values()];
}

/** One item of a Call step's visit (`each`), as the log tells it. */
export type DerivedItem = {
	facts: ItemFacts;
	/** 1-based among the started items; null for an item that was blocked. */
	index: number | null;
	/**
	 * `running` only while the Call step runs. An item whose Call step
	 * step ended (stopped, failed, interrupted) before the item did shows
	 * `failed` with the reason; `open` still tells that the item never ended.
	 */
	state: ItemState;
	/** No `ItemEnded` yet: a resume continues this item. */
	open: boolean;
	branch: string | null;
	baseBranch: string | null;
	/** The called flow's input values. Null before flow format 2. */
	inputs: InputValues | null;
	/** The called flow's declared outputs for this element, once it ended. */
	outputs: StepOutputs;
	startedAt: number;
	endedAt: number | null;
	reason: string | null;
};

export type DerivedStep = {
	id: string;
	nodeId: string;
	nodeType: FlowNodeType;
	visit: number;
	scope: Scope | null;
	transcriptPath: string;
	logPath: string | null;
	/** The Device the step ran on (its Placement). Null before steps named it. */
	deviceId: string | null;
	startedAt: number;
	startSeq: number;
	/** The seq of the latest `StepStarted` or `StepReopened`. */
	openedSeq: number;
	/** Null while the step runs (also after a reopen). */
	endedAt: number | null;
	outcome: StepOutcome | null;
	outputs: StepOutputs;
	error: string | null;
	sessions: DerivedSession[];
	/** Harness sessions plus what the step spent itself (a decider). */
	cost: CostTally;
	/**
	 * Gate steps, and an Agent step while it asks a person: the latest
	 * `GateOpened` of this step. Null again once the step reopens.
	 */
	gate: {
		question: string;
		choices: GateChoice[];
		/** The flow author let a person answer this Gate from the lock screen. */
		lockScreen: boolean;
		openedAt: number;
		openedSeq: number;
		/** When nobody answered by then, the Gate takes an option. Null without one. */
		deadline: GateDeadline | null;
	} | null;
	/** Call steps with `each` only: its items in the order they started or were blocked. */
	items: DerivedItem[];
	/** Call steps (once) only: the call, once its inputs were bound. */
	call: EnginePayloads["FlowCalled"] | null;
};

/**
 * The node types of runs from before flow version 4, read as today's: a
 * Subflow step and a For Each step are Call steps. The one place the read
 * model maps them, so old runs render like new ones.
 */
const legacyNodeTypes: Readonly<Record<string, FlowNodeType>> = {
	subflow: "call",
	foreach: "call",
};

/** A logged node type as today's `FlowNodeType`. */
export function nodeTypeOf(logged: string): FlowNodeType {
	return legacyNodeTypes[logged] ?? (logged as FlowNodeType);
}

/**
 * Steps in the order they started. A step's outcome comes from the latest
 * `StepEnded` after its latest opening, so a reopened step is open again
 * until it ends again.
 */
export function deriveSteps(events: readonly LoggedEvent[]): DerivedStep[] {
	const steps = new Map<string, DerivedStep>();
	for (const e of bySeq(events)) {
		if (!e.stepId) continue;
		if (e.type === "StepStarted") {
			steps.set(e.stepId, {
				id: e.stepId,
				nodeId: e.payload.nodeId,
				nodeType: nodeTypeOf(e.payload.nodeType),
				visit: e.payload.visit,
				scope: e.payload.scope ?? null,
				transcriptPath: e.payload.transcriptPath,
				logPath: e.payload.logPath,
				deviceId: e.payload.deviceId ?? null,
				startedAt: e.at,
				startSeq: e.seq,
				openedSeq: e.seq,
				endedAt: null,
				outcome: null,
				outputs: { visit: e.payload.visit },
				error: null,
				sessions: [],
				cost: NO_COST,
				gate: null,
				items: [],
				call: null,
			});
			continue;
		}
		const step = steps.get(e.stepId);
		if (!step) continue;
		if (e.type === "GateOpened") {
			step.gate = {
				question: e.payload.question,
				choices: e.payload.choices,
				lockScreen: e.payload.lockScreen === true,
				openedAt: e.at,
				openedSeq: e.seq,
				deadline: e.payload.deadline ?? null,
			};
		} else if (e.type === "StepReopened") {
			step.openedSeq = e.seq;
			step.endedAt = null;
			step.outcome = null;
			step.error = null;
			// A Gate the step asked is closed: an Agent goes on with the answer.
			step.gate = null;
		} else if (e.type === "StepEnded" && step.endedAt === null) {
			step.endedAt = e.at;
			step.outcome = e.payload.outcome;
			step.outputs = e.payload.outputs;
			step.error = e.payload.error;
			step.cost = addCost(step.cost, stepEndCost(e.payload));
		} else if (e.type === "FlowCalled") {
			step.call = e.payload;
		} else if (e.type === "ItemStarted") {
			step.items.push({
				facts: e.payload.item,
				index: e.payload.index,
				state: "running",
				open: true,
				branch: e.payload.branch,
				baseBranch: e.payload.baseBranch,
				inputs: e.payload.inputs ?? null,
				outputs: {},
				startedAt: e.at,
				endedAt: null,
				reason: null,
			});
		} else if (e.type === "ItemBlocked") {
			step.items.push({
				facts: e.payload.item,
				index: null,
				state: "blocked",
				open: false,
				branch: null,
				baseBranch: null,
				inputs: null,
				outputs: {},
				startedAt: e.at,
				endedAt: e.at,
				reason: e.payload.reason,
			});
		} else if (e.type === "ItemEnded") {
			const item = step.items.findLast(
				(i) => i.facts.id === e.payload.itemId && i.open,
			);
			if (item) {
				item.open = false;
				item.state = e.payload.state;
				item.reason = e.payload.reason;
				item.outputs = e.payload.outputs ?? {};
				item.endedAt = e.at;
			}
		}
	}
	for (const session of deriveSessions(events)) {
		const step = session.stepId ? steps.get(session.stepId) : undefined;
		if (!step) continue;
		step.sessions.push(session);
		step.cost = addCost(step.cost, sessionCost(session));
	}
	for (const step of steps.values()) {
		if (step.endedAt === null) continue;
		for (const item of step.items) {
			if (!item.open) continue;
			item.state = "failed";
			item.reason = cutShort[step.outcome ?? ""] ?? cutShort.error ?? null;
			item.endedAt = step.endedAt;
		}
	}
	return [...steps.values()];
}

/** Why an item that was still running ended with its Call step. */
const cutShort: Record<string, string> = {
	stopped: "The run stopped during this item.",
	interrupted: "Night Shift stopped during this item.",
	error: "The step failed during this item.",
};

/** The state of each item of a Call step's visit, by item id. */
export function itemStates(step: DerivedStep): Record<string, ItemState> {
	const states: Record<string, ItemState> = {};
	for (const item of step.items) states[item.facts.id] = item.state;
	return states;
}

/** The template outputs of the latest ended visit of each node of one scope (default: the top level). */
export function deriveNodeOutputs(
	events: readonly LoggedEvent[],
	key = "",
): NodeOutputs {
	const nodes: NodeOutputs = {};
	const nodeOf = new Map<string, string>();
	for (const e of bySeq(events)) {
		if (e.type === "StepStarted" && e.stepId) {
			if (scopeKey(e.payload.scope) === key) {
				nodeOf.set(e.stepId, e.payload.nodeId);
			}
		} else if (e.type === "StepEnded" && e.stepId) {
			const nodeId = nodeOf.get(e.stepId);
			if (nodeId) nodes[nodeId] = { ...e.payload.outputs };
		}
	}
	return nodes;
}

/**
 * The variables of one scope (default: the top level) as the log has them:
 * the values the flow started with, then each step's writes in order.
 */
export function deriveVariables(
	events: readonly LoggedEvent[],
	key = "",
): Record<string, JsonValue> {
	let values: Record<string, JsonValue> = {};
	const inScope = new Set<string>();
	for (const e of bySeq(events)) {
		if (e.type === "VariablesSet") {
			if (scopeKey(e.payload.scope) === key) {
				values = { ...values, ...e.payload.values };
			}
		} else if (e.type === "StepStarted" && e.stepId) {
			if (scopeKey(e.payload.scope) === key) inScope.add(e.stepId);
		} else if (
			e.type === "StepEnded" &&
			e.stepId &&
			inScope.has(e.stepId) &&
			e.payload.variables
		) {
			values = { ...values, ...e.payload.variables };
		}
	}
	return values;
}

/** One value a variable took in a run, from the log. */
export type VariableChange = {
	/** The flow invocation the variable belongs to: null for the run's top-level flow. */
	scope: Scope | null;
	name: string;
	value: JsonValue;
	/** The step whose write set it; null for the value the flow started with. */
	stepId: string | null;
	/** A start value an earlier run kept (`keep`), not the variable's `initial`. */
	kept?: true;
	at: number;
};

/**
 * Every value each variable took, in every scope, oldest first: the values
 * each flow started with (`VariablesSet`), then each step's writes.
 */
export function deriveVariableChanges(
	events: readonly LoggedEvent[],
): VariableChange[] {
	const changes: VariableChange[] = [];
	const scopeOfStep = new Map<string, Scope | null>();
	for (const e of bySeq(events)) {
		if (e.type === "VariablesSet") {
			const kept = new Set(e.payload.kept ?? []);
			for (const [name, value] of Object.entries(e.payload.values)) {
				changes.push({
					scope: e.payload.scope ?? null,
					name,
					value,
					stepId: null,
					...(kept.has(name) ? { kept: true as const } : {}),
					at: e.at,
				});
			}
		} else if (e.type === "StepStarted" && e.stepId) {
			scopeOfStep.set(e.stepId, e.payload.scope ?? null);
		} else if (e.type === "StepEnded" && e.stepId && e.payload.variables) {
			for (const [name, value] of Object.entries(e.payload.variables)) {
				changes.push({
					scope: scopeOfStep.get(e.stepId) ?? null,
					name,
					value,
					stepId: e.stepId,
					at: e.at,
				});
			}
		}
	}
	return changes;
}

/** How many visits of the node (in one scope, default the top level) the run started so far. */
export function countVisits(
	events: readonly LoggedEvent[],
	nodeId: string,
	key = "",
): number {
	return ofType(events, "StepStarted").filter(
		(e) => e.payload.nodeId === nodeId && scopeKey(e.payload.scope) === key,
	).length;
}

/** The harness session id of the node's latest session (in one scope, default the top level) that has one. */
export function lastHarnessSessionOfNode(
	events: readonly LoggedEvent[],
	nodeId: string,
	key = "",
): string | null {
	const steps = deriveSteps(events).filter(
		(s) => s.nodeId === nodeId && scopeKey(s.scope) === key,
	);
	const sessions = steps.flatMap((s) => s.sessions);
	sessions.sort((a, b) => a.startSeq - b.startSeq);
	return sessions.findLast((s) => s.harnessSessionId)?.harnessSessionId ?? null;
}

/** The run's latest session that has a harness session id. */
export function lastHarnessSession(
	events: readonly LoggedEvent[],
): { harness: AgentHarnessName; harnessSessionId: string } | null {
	const session = deriveSessions(events).findLast((s) => s.harnessSessionId);
	return session?.harnessSessionId
		? { harness: session.harness, harnessSessionId: session.harnessSessionId }
		: null;
}

/**
 * The run's cost: what each ended session reported, plus what steps spent
 * outside sessions (a decider). `steps`: the run's steps, when the caller
 * derived them already.
 */
export function sumCost(
	events: readonly LoggedEvent[],
	steps: readonly DerivedStep[] = deriveSteps(events),
): CostTally {
	const stepIds = new Set(steps.map((s) => s.id));
	let total = NO_COST;
	for (const step of steps) total = addCost(total, step.cost);
	// A session whose step is missing from the log still cost money.
	for (const session of deriveSessions(events)) {
		if (session.stepId && stepIds.has(session.stepId)) continue;
		total = addCost(total, sessionCost(session));
	}
	return total;
}

/** The step and the calling steps (Call) it runs in, from the inside out. */
export function withEnclosing(
	steps: readonly DerivedStep[],
	stepId: string,
): DerivedStep[] {
	const byId = new Map(steps.map((s) => [s.id, s]));
	const chain: DerivedStep[] = [];
	for (
		let step = byId.get(stepId);
		step;
		step = step.scope ? byId.get(step.scope.parentStepId) : undefined
	) {
		chain.push(step);
	}
	return chain;
}
