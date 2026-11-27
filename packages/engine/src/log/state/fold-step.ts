import {
	DEFAULT_GATE_URGENCY,
	type FlowNodeType,
	type ItemState,
	NODE_TYPE_LABEL,
} from "@nightshift/flows";
import {
	answeredBy,
	type GateBrief,
	type LoggedEvent,
	type StepOutputs,
	scopeKey,
} from "../events";
import {
	addCost,
	deciderCost,
	NO_COST,
	sessionCost,
	stepEndCost,
} from "./cost";
import { closeLast, type Draft, logged } from "./draft";
import { type DerivedStep, type StepOpening, visitKey } from "./run-state";

/**
 * What an event of a step means for the run state (`fold-run.ts`): its
 * openings and ends, its sleeps, its Gate, its items and its clock.
 */

/** A logged node type. One this build does not know reads as a Call step: no reader of a step meets it. */
function nodeTypeOf(logged: string): FlowNodeType {
	return Object.hasOwn(NODE_TYPE_LABEL, logged)
		? (logged as FlowNodeType)
		: "call";
}

/** Why an item that was still running ended with its Call step. */
const cutShort: Record<string, string> = {
	stopped: "The run stopped during this item.",
	interrupted: "Night Shift stopped during this item.",
	error: "The step failed during this item.",
};

/** The brief of a Gate that nobody wrote: what an older log reads as (ADR 21). */
function emptyGateBrief(): GateBrief {
	return {
		urgencyBy: "default",
		situation: null,
		background: [],
		recommendation: null,
		byModel: [],
	};
}

/** The step with its derived fields set again from its openings, sessions and items. */
export function settle(step: DerivedStep): DerivedStep {
	const current = step.openings.at(-1);
	const end = current?.end ?? null;
	let outputs: StepOutputs = { visit: step.visit };
	for (let i = step.openings.length - 1; i >= 0; i--) {
		const opening = step.openings[i] as StepOpening;
		if (opening.end) {
			outputs = opening.end.payload.outputs;
			break;
		}
		if (opening.kind === "start") break;
	}
	let cost = NO_COST;
	for (const opening of step.openings) {
		if (opening.end) cost = addCost(cost, opening.end.cost);
	}
	for (const session of step.sessions)
		cost = addCost(cost, sessionCost(session));
	// The model that wrote a Gate's brief (ADR 21).
	for (const wait of step.gateWaits) {
		if (wait.briefCost) cost = addCost(cost, wait.briefCost);
	}
	const endedAt = end?.at ?? null;
	const outcome = end?.payload.outcome ?? null;
	// While the step stays open, an open item is already running. A reopen
	// is the case that puts one back: the step still carries its old end.
	const items =
		endedAt === null && step.endedAt === null
			? step.items
			: step.items.map((item) => {
					if (!item.open) return item;
					const state: ItemState = endedAt === null ? "running" : "failed";
					const reason =
						endedAt === null
							? null
							: (cutShort[outcome ?? ""] ?? cutShort.error ?? null);
					return item.state === state &&
						item.reason === reason &&
						item.endedAt === endedAt
						? item
						: { ...item, state, reason, endedAt };
				});
	return {
		...step,
		openedSeq: current?.seq ?? step.startSeq,
		endedAt,
		outcome,
		outputs,
		error: end?.payload.error ?? null,
		cost,
		items,
	};
}

/** Appends to a list this fold already owns. A published state gets a copy first. */
function appendOwned<T>(
	owned: WeakSet<readonly unknown[]>,
	list: readonly T[],
	item: T,
): readonly T[] {
	if (owned.has(list)) {
		(list as T[]).push(item);
		return list;
	}
	const next = list.slice();
	next.push(item);
	owned.add(next);
	return next;
}

/** Writes one entry of a list this fold already owns. A published state gets a copy first. */
function writeOwned<T>(
	owned: WeakSet<readonly unknown[]>,
	list: readonly T[],
	index: number,
	item: T,
): readonly T[] {
	if (owned.has(list)) {
		(list as T[])[index] = item;
		return list;
	}
	const next = list.slice();
	next[index] = item;
	owned.add(next);
	return next;
}

export function applyStepEvent(
	run: Draft,
	e: LoggedEvent,
	stepId: string,
	owned: WeakSet<readonly unknown[]>,
): void {
	if (e.type === "StepStarted") {
		startStep(run, e, stepId);
		return;
	}
	const known = run.steps.get(stepId);
	if (!known) return;
	let step: DerivedStep = known;
	if (
		e.type === "WaitEnded" ||
		e.type === "StepEnded" ||
		e.type === "StepReopened"
	) {
		step = { ...step, sleeps: closeLast(step.sleeps, e.at) };
	}
	if (e.type === "StepEnded" || e.type === "StepReopened") {
		step = { ...step, gateWaits: closeLast(step.gateWaits, e.at) };
	}
	const current = step.openings.at(-1);
	switch (e.type) {
		case "KnowledgeSearched":
			step = {
				...step,
				knowledge: [...step.knowledge, { type: e.type, ...logged(e) }],
			};
			break;
		case "KnowledgeRead":
			step = {
				...step,
				knowledge: [...step.knowledge, { type: e.type, ...logged(e) }],
			};
			break;
		case "Scored": {
			const by = answeredBy(e.payload);
			const wait = step.gateWaits.at(-1);
			if (by && wait && wait.answeredBy === null) {
				step = {
					...step,
					gateWaits: [
						...step.gateWaits.slice(0, -1),
						{
							...wait,
							answeredBy: by,
							answer: e.payload.label,
							answeredAt: e.at,
						},
					],
				};
			}
			break;
		}
		case "WaitStarted": {
			const sleep = step.sleeps.at(-1);
			// A wait logged again in the same sleep (a new daemon) goes on
			// with it. One after the step's end is the late write of a daemon
			// that died: the step does not sleep.
			if (step.endedAt === null && (!sleep || sleep.to !== null)) {
				step = {
					...step,
					sleeps: [
						...step.sleeps,
						{
							from: e.at,
							to: null,
							opening: step.openings.length - 1,
							reason: e.payload.reason,
							signal: e.payload.signal ?? null,
						},
					],
				};
			}
			break;
		}
		case "WaitEnded":
		case "ItemStarted":
			step = enteredAt(step, e.at);
			if (e.type === "ItemStarted") {
				step = {
					...step,
					items: appendOwned(owned, step.items, {
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
					}),
				};
			}
			break;
		case "GateOpened": {
			const wait = step.gateWaits.at(-1);
			const urgency = e.payload.urgency ?? DEFAULT_GATE_URGENCY;
			const briefCost =
				e.payload.briefCostUsd === undefined
					? undefined
					: deciderCost(e.payload.briefCostUsd, e.payload.briefCostSource);
			// Asked again while the Gate waits (a new daemon): the same wait.
			const again = wait !== undefined && wait.to === null;
			if (!again) {
				step = {
					...step,
					gateWaits: [
						...step.gateWaits,
						{
							from: e.at,
							to: null,
							opening: step.openings.length - 1,
							question: e.payload.question,
							urgency,
							choices: e.payload.choices,
							brief: e.payload.brief ?? emptyGateBrief(),
							...(briefCost ? { briefCost } : {}),
							answeredBy: null,
							answer: null,
							...(e.payload.form ? { ask: true as const } : {}),
						},
					],
				};
			} else if (briefCost) {
				const sum = wait.briefCost
					? addCost(wait.briefCost, briefCost)
					: briefCost;
				step = {
					...step,
					gateWaits: [
						...step.gateWaits.slice(0, -1),
						{ ...wait, briefCost: sum },
					],
				};
			}
			step = {
				...step,
				gate: {
					question: e.payload.question,
					choices: e.payload.choices,
					urgency,
					brief: e.payload.brief ?? emptyGateBrief(),
					lockScreen: e.payload.lockScreen === true,
					openedAt: e.at,
					openedSeq: e.seq,
					deadline: e.payload.deadline ?? null,
					form: e.payload.form ?? null,
					// The same wait keeps the answer that waits for it.
					queued: again ? (step.gate?.queued ?? null) : null,
					dropped: again ? (step.gate?.dropped ?? null) : null,
				},
			};
			break;
		}
		case "AnswerQueued":
			if (step.gate && step.endedAt === null) {
				step = {
					...step,
					gate: { ...step.gate, queued: e.payload, dropped: null },
				};
			}
			break;
		case "RunWarned":
			if (e.payload.kind === "answer-dropped" && step.gate) {
				step = {
					...step,
					gate: { ...step.gate, queued: null, dropped: e.payload.message },
				};
			}
			break;
		case "StepReopened":
			step = enteredAt(
				{
					...step,
					openings: [
						...step.openings,
						{
							kind: "reopen",
							seq: e.seq,
							at: e.at,
							prompt: e.payload.prompt,
							end: null,
						},
					],
					// A Gate the step asked is closed: an Agent goes on with the answer.
					gate: null,
					clock: clockOf(e.payload, step.clock.since),
				},
				e.at,
			);
			break;
		case "StepEnded":
			// The first end after an opening counts: a late duplicate changes nothing.
			if (!current || current.end) break;
			step = {
				...step,
				openings: [
					...step.openings.slice(0, -1),
					{
						...current,
						end: {
							seq: e.seq,
							at: e.at,
							payload: e.payload,
							cost: stepEndCost(e.payload),
						},
					},
				],
			};
			endedStep(run, step, e);
			break;
		case "FlowCalled":
			step = { ...step, call: e.payload };
			break;
		case "ItemBlocked":
			step = {
				...step,
				items: appendOwned(owned, step.items, {
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
				}),
			};
			break;
		case "ItemEnded": {
			const at = step.items.findLastIndex(
				(i) => i.facts.id === e.payload.itemId && i.open,
			);
			if (at !== -1) {
				const item = step.items[at];
				if (!item) break;
				step = {
					...step,
					items: writeOwned(owned, step.items, at, {
						...item,
						open: false,
						state: e.payload.state,
						reason: e.payload.reason,
						outputs: e.payload.outputs ?? {},
						endedAt: e.at,
					}),
				};
			}
			break;
		}
	}
	if (step !== known) run.steps.set(stepId, settle(step));
}

function clockOf(
	budget: { timeoutMs?: number; idleMs?: number },
	since: number,
): DerivedStep["clock"] {
	return {
		timeoutMs: budget.timeoutMs ?? null,
		idleMs: budget.idleMs ?? null,
		since,
	};
}

function enteredAt(step: DerivedStep, at: number): DerivedStep {
	return at > step.clock.since
		? { ...step, clock: { ...step.clock, since: at } }
		: step;
}

/** The step's node entered at `at`: its clock counts from there. */
function enter(run: Draft, stepId: string, at: number): void {
	const step = run.steps.get(stepId);
	if (!step) return;
	const entered = enteredAt(step, at);
	if (entered !== step) run.steps.set(stepId, entered);
}

/** An event inside a Call step (of a step it calls, at any depth) enters each Call step around it. */
export function enterCallers(run: Draft, e: LoggedEvent): void {
	const seen = new Set<string>();
	let caller =
		e.type === "EdgeTaken"
			? e.payload.scope?.parentStepId
			: e.stepId
				? run.steps.get(e.stepId)?.scope?.parentStepId
				: undefined;
	while (caller && !seen.has(caller)) {
		seen.add(caller);
		enter(run, caller, e.at);
		caller = run.steps.get(caller)?.scope?.parentStepId;
	}
}

function startStep(
	run: Draft,
	e: Extract<LoggedEvent, { type: "StepStarted" }>,
	stepId: string,
): void {
	const known = run.steps.get(stepId);
	const scope = e.payload.scope ?? null;
	const rung = e.payload.rung ?? known?.rung;
	const test = e.payload.test;
	// A pinned step names the earlier step its output comes from.
	const pin =
		test === "pinned" ? run.test?.pinned[e.payload.nodeId] : undefined;
	const opening: StepOpening = {
		kind: "start",
		seq: e.seq,
		at: e.at,
		prompt: null,
		end: null,
	};
	if (!known) {
		run.stepsSinceWalk += 1;
		const visits = visitKey(e.payload.nodeId, scopeKey(scope));
		run.visits.set(visits, (run.visits.get(visits) ?? 0) + 1);
	}
	run.steps.set(
		stepId,
		settle({
			id: stepId,
			nodeId: e.payload.nodeId,
			nodeType: nodeTypeOf(e.payload.nodeType),
			visit: e.payload.visit,
			scope,
			transcriptPath: e.payload.transcriptPath,
			logPath: e.payload.logPath,
			deviceId: e.payload.deviceId ?? null,
			...(rung ? { rung } : {}),
			...(test ? { test } : {}),
			...(pin
				? {
						pinnedFrom: {
							runId: pin.runId,
							stepId: pin.stepId,
							endedAt: pin.endedAt,
						},
					}
				: {}),
			startedAt: e.at,
			startSeq: e.seq,
			openedSeq: e.seq,
			// A second start of the step is a new opening: what it had stays.
			openings: [...(known?.openings ?? []), opening],
			endedAt: null,
			outcome: null,
			outputs: {},
			error: null,
			sessions: known?.sessions ?? [],
			cost: NO_COST,
			gate: null,
			sleeps: known?.sleeps ?? [],
			gateWaits: known?.gateWaits ?? [],
			items: [],
			knowledge: known?.knowledge ?? [],
			call: null,
			clock: clockOf(e.payload, Math.max(known?.clock.since ?? e.at, e.at)),
		}),
	);
}

/** What a step's end (the first after an opening) writes beyond the step: its outputs and variables. */
function endedStep(
	run: Draft,
	step: DerivedStep,
	e: Extract<LoggedEvent, { type: "StepEnded" }>,
): void {
	const key = scopeKey(step.scope);
	run.nodeOutputs.set(key, {
		...run.nodeOutputs.get(key),
		[step.nodeId]: { ...e.payload.outputs },
	});
	const { variables } = e.payload;
	if (!variables) return;
	run.variables.set(key, { ...run.variables.get(key), ...variables });
	for (const [name, value] of Object.entries(variables)) {
		run.variableChanges.push({
			scope: step.scope,
			name,
			value,
			stepId: step.id,
			at: e.at,
		});
	}
}
