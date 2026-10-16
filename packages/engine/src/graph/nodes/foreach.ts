import { Command } from "@langchain/langgraph";
import {
	blockersFirst,
	type ForEachNode,
	type ListItem,
	newlyBlocked,
	nextItem,
	renderCommand,
	renderTemplate,
	type TemplateContext,
} from "@nightshift/flows";

import { runCommand } from "../../command";
import {
	type DerivedStep,
	deriveSteps,
	deriveStopAfterStep,
	deriveStopAt,
	type EnginePayloads,
	type InputValues,
	type ItemFacts,
	itemStates,
	type LoggedEvent,
	type Scope,
	type StepOutputs,
} from "../../events";
import {
	fileItems,
	forEachOutputs,
	itemLabel,
	jsonSourceItems,
	parseCommandItems,
	toItemFacts,
} from "../../foreach";
import { renderBindings, resolveInputs } from "../../inputs";
import { commandLogPath } from "../../transcripts";
import type { StepOutcome } from "../../types";
import {
	createAndCheckoutBranch,
	currentBranch,
	freeBranchName,
	itemBranchName,
} from "../../worktrees";
import {
	beginStep,
	messageOf,
	type NodeAction,
	STOP_AFTER_STEP_REASON,
	STOP_TIME_REASON,
	type StepContext,
	type StepStart,
	uncommittedStep,
} from "../context";
import { parkCommand, route, type StepEnd, scopeOf } from "../route";
import type { Loop, RunStateValues } from "../state";
import {
	type BodyGraph,
	bodyGraph,
	bodyOutputs,
	continueStep,
	latestStepOf,
	runBody,
} from "./body";

/**
 * The For Each node, ported from `runForEachStep` in engine.ts (design
 * rule 13). One element per super-step: the node reads its source again,
 * marks the elements a failed or blocked one blocks, starts the next free
 * element (`ItemStarted`, on its own branch on top of the last element
 * that finished with `branch: "per-item"`), runs the body as a subgraph in
 * the scope `{ parentStepId: stepId, itemId }` with the element's
 * `{{run.*}}` fields, ends the element (`ItemEnded`) and jumps back to
 * itself with the cursor in `state.loops[node.id]`. The step stays open
 * across the elements (`beginStep` continues it, appending nothing) and
 * ends `done` when no element is left to start, `halted` when a body ended
 * on a `haltOn` label, `error` when the source or a binding refused.
 *
 * A failed element does not fail the step: the body's park is swallowed
 * (`runBody`), the element ends `failed` with the reason, and the loop goes
 * on with free work. A stop inside the body ends the step `stopped` and
 * propagates the park; a wait or a Gate inside the body propagates with
 * the step open. Everything before the body runs again on the resume and
 * after a daemon death (rule 4), so the node continues the open element it
 * finds in the log (no `ItemStarted` or branch twice) and the body resumes
 * under the same namespace; an ended step (stopped, or `interrupted` by
 * recovery) is reopened first (`StepReopened`), as `openCallStep` does.
 */
export function forEachNode(node: ForEachNode, ctx: StepContext): NodeAction {
	let graph: BodyGraph | null = null;
	return async (state, config) => {
		const runId = ctx.run.id;
		const scope = scopeOf(config);
		const events = await ctx.log.events(runId);
		const begun = await beginStep(
			ctx,
			node,
			state,
			config,
			entryOf(node, state, events, scope),
		);
		if (begun.kind === "parked") return begun.command;
		const step = begun.step;
		const { stepId, visit, tctx } = step;
		const changed = () =>
			ctx.bus.publish(runId, { kind: "step-changed", stepId });

		/** The read of the source in this super-step, for `waiting_count`. */
		let lastRead: ListItem[] = [];

		const current = async (): Promise<DerivedStep> => {
			const found = deriveSteps(await ctx.log.events(runId)).find(
				(s) => s.id === stepId,
			);
			if (!found) throw new Error(`Step not found: ${stepId}`);
			return found;
		};
		const endStep = async (
			outcome: StepOutcome,
			error: string | null,
		): Promise<StepEnd> => {
			const derived = await current();
			const states = itemStates(derived);
			const waitingCount = lastRead.filter(
				(item) => !item.done && !Object.hasOwn(states, item.id),
			).length;
			return step.end(
				outcome,
				forEachOutputs({ items: derived.items, visit, outcome, waitingCount }),
				error,
			);
		};
		const finish = async (outcome: StepOutcome, error: string | null) =>
			route(ctx, state, node, await endStep(outcome, error), config, {
				loops: { [node.id]: null },
			});
		/** The step ends `stopped` and the run parks here with the stop's reason (null for a person's stop). */
		const parkStopped = async (reason: string | null) => {
			const end = await endStep("stopped", null);
			return parkCommand({
				node,
				status: "stopped",
				reason,
				step: end,
				update: {
					loops: { [node.id]: null },
					nodes: { [node.id]: end.outputs },
					visits: { [node.id]: visit },
				},
			});
		};
		const endItem = async (
			itemId: string,
			itemState: EnginePayloads["ItemEnded"]["state"],
			reason: string | null,
			outputs: StepOutputs,
		) => {
			await ctx.log.append({
				type: "ItemEnded",
				runId,
				stepId,
				payload: { itemId, state: itemState, reason, outputs },
			});
			step.record(null, { type: "item-end", itemId, state: itemState, reason });
			changed();
		};
		/**
		 * Back to this node for the next element, with the cursor checkpointed
		 * (the list and the element's result are in the log). `pending` is
		 * cleared as `route()` does: a resume through the park node set it,
		 * and the next entry must not read it again.
		 */
		const next = (element: Element) => {
			step.leaveOpen();
			const cursor: Loop = { index: element.index };
			return new Command({
				update: {
					loops: { [node.id]: cursor },
					visits: { [node.id]: visit },
					pending: null,
				},
				goto: node.id,
			});
		};

		const called = ctx.flows[node.flow];
		if (!called) {
			return finish(
				"error",
				`The flow "${node.flow}" is not in the run's snapshot.`,
			);
		}
		const as = node.as ?? "item";
		const haltOn = node.haltOn ?? ["halt"];
		const perItem = (node.branch ?? "per-item") === "per-item";
		const worktree = ctx.run.worktreePath;

		let element: Element;
		const open = step.existing?.items.findLast(
			(i) => i.open && i.index !== null,
		);
		if (open && open.index !== null) {
			// A resume, or a re-run after a daemon death: the element goes on.
			element = {
				facts: open.facts,
				index: open.index,
				branch: open.branch,
				baseBranch: open.baseBranch,
				// Before flow format 2 the element was the only input.
				inputs: open.inputs ?? { [as]: open.facts.value },
			};
		} else {
			if (ctx.signal().aborted) return parkStopped(null);
			const stop = stopBeforeNext(ctx, await ctx.log.events(runId));
			if (stop) return parkStopped(stop);

			let items: ListItem[];
			try {
				items = await readSource(ctx, node, tctx, stepId);
			} catch (error) {
				if (ctx.signal().aborted) return parkStopped(null);
				return finish("error", messageOf(error));
			}
			const ordered = blockersFirst(items);
			if (!ordered.ok) {
				const names = ordered.cycle.map((id) => itemLabel({ id }));
				return finish(
					"error",
					`The "blocked by" links of the items make a cycle: ${names.join(" → ")}.`,
				);
			}
			lastRead = ordered.items;
			let derived = await current();
			let states = itemStates(derived);
			const openCount = ordered.items.filter(
				(item) => !item.done && !Object.hasOwn(states, item.id),
			).length;
			await ctx.log.append({
				type: "ItemsRead",
				runId,
				stepId,
				payload: { count: items.length, open: openCount },
			});
			step.record(null, {
				type: "items-read",
				count: items.length,
				open: openCount,
			});

			const blocked = newlyBlocked(ordered.items, states);
			for (const { item, blocker } of blocked) {
				const reason = `blocked by ${itemLabel({ id: blocker })}`;
				await ctx.log.append({
					type: "ItemBlocked",
					runId,
					stepId,
					payload: { item: toItemFacts(item), blocker, reason },
				});
				step.record(null, {
					type: "item-end",
					itemId: item.id,
					state: "blocked",
					reason,
				});
			}
			if (blocked.length > 0) {
				changed();
				derived = await current();
				states = itemStates(derived);
			}

			const started = derived.items.filter((i) => i.index !== null).length;
			if (node.maxItems !== undefined && started >= node.maxItems) {
				return finish("done", null);
			}
			const picked = nextItem(ordered.items, states);
			if (picked.kind !== "item") return finish("done", null);

			const facts = toItemFacts(picked.item);
			let inputs: InputValues;
			try {
				inputs = resolveInputs(
					called.inputs ?? [],
					{ ...renderBindings(node.inputs, tctx), [as]: facts.value },
					{ what: `The flow "${node.flow}"`, jsonText: "lenient" },
				);
			} catch (error) {
				return finish("error", messageOf(error));
			}
			const index = started + 1;
			let branch: string | null = null;
			let baseBranch: string | null = null;
			let failure: string | null = null;
			if (perItem) {
				try {
					const startBranch =
						derived.items.find((i) => i.index !== null)?.baseBranch ??
						(await currentBranch(worktree)) ??
						tctx.run.branch;
					baseBranch =
						derived.items.findLast((i) => i.state === "done" && i.branch)
							?.branch ?? startBranch;
					const name = await freeBranchName(
						worktree,
						itemBranchName(runId.slice(0, 8), facts),
					);
					await createAndCheckoutBranch(worktree, name, baseBranch);
					branch = name;
				} catch (error) {
					failure = messageOf(error);
				}
			}
			await ctx.log.append({
				type: "ItemStarted",
				runId,
				stepId,
				payload: { item: facts, index, branch, baseBranch, inputs },
			});
			step.record(null, {
				type: "item-start",
				itemId: facts.id,
				title: facts.title,
				branch,
				baseBranch,
			});
			changed();
			element = { facts, index, branch, baseBranch, inputs };
			if (failure !== null) {
				await endItem(facts.id, "failed", failure, {});
				return next(element);
			}
		}

		const body = {
			called,
			flowName: node.flow,
			inputs: element.inputs,
			scope: { parentStepId: stepId, itemId: element.facts.id } as Scope,
			run: {
				branch: element.branch ?? tctx.run.branch,
				base_branch: element.baseBranch ?? "",
				index: String(element.index - 1),
			},
		};
		graph ??= bodyGraph(ctx, called, node.flow);
		const ended = await runBody({ graph, config, ...body });
		switch (ended.kind) {
			case "paused":
				// The step stays open: the element continues after the wait.
				step.leaveOpen();
				throw ended.interrupt;
			case "stopped":
				await endStep("stopped", null);
				throw ended.interrupt;
			case "aborted":
				await endStep("error", ended.reason);
				throw ended.interrupt;
			case "failed": {
				const outputs = await bodyOutputs(ctx, body);
				await endItem(element.facts.id, "failed", ended.reason, outputs);
				return next(element);
			}
			case "finished": {
				const outputs = await bodyOutputs(ctx, body, ended.nodes);
				if (haltOn.includes(ended.outcome)) {
					await endItem(
						element.facts.id,
						"halted",
						`Ended at node "${ended.node.id}" with "${ended.outcome}".`,
						outputs,
					);
					return finish("halted", null);
				}
				await endItem(element.facts.id, "done", null, outputs);
				return next(element);
			}
		}
	};
}

/** One element the node runs: what `ItemStarted` recorded. */
type Element = {
	facts: ItemFacts;
	index: number;
	branch: string | null;
	baseBranch: string | null;
	inputs: InputValues;
};

/**
 * How the node enters. A run parked at this node's own park node (a stop
 * between elements, or the step ended `error`) reopens the step and goes
 * on with the loop; an ended visit with an exhausted edge starts a new
 * one. Mid-loop (`state.loops` set) the open step continues. Else the step
 * the log has that the graph never committed (the first element was
 * running) is continued or reopened; else a new visit.
 */
function entryOf(
	node: ForEachNode,
	state: RunStateValues,
	events: readonly LoggedEvent[],
	scope: Scope | null,
): StepStart {
	const pending = state.pending;
	if (pending?.nodeId === node.id) {
		const own =
			pending.kind === "parked" && pending.stepId
				? (deriveSteps(events).find((s) => s.id === pending.stepId) ?? null)
				: null;
		const cutShort =
			own?.outcome === "stopped" ||
			own?.outcome === "error" ||
			own?.outcome === "interrupted";
		return cutShort ? continueStep(own) : { kind: "new" };
	}
	if (state.loops[node.id]) {
		return continueStep(latestStepOf(node, events, scope));
	}
	return continueStep(uncommittedStep(node, state, events, scope));
}

/** Why the loop must stop before the next element, or null. */
function stopBeforeNext(
	ctx: StepContext,
	events: readonly LoggedEvent[],
): string | null {
	if (deriveStopAfterStep(events)) return STOP_AFTER_STEP_REASON;
	const stopAt = deriveStopAt(events);
	if (stopAt !== null && ctx.now() >= stopAt) return STOP_TIME_REASON;
	return null;
}

/**
 * Reads the source as list items: a JSON value, the JSON a command prints
 * in the worktree, or files that match a glob. Throws with a readable
 * message. Ported from `readSource` in engine.ts.
 */
async function readSource(
	ctx: StepContext,
	node: ForEachNode,
	tctx: TemplateContext,
	stepId: string,
): Promise<ListItem[]> {
	const worktree = ctx.run.worktreePath;
	const source = node.source;
	switch (source.kind) {
		case "json":
			return jsonSourceItems(source.value, tctx);
		case "files":
			return fileItems(worktree, renderTemplate(source.glob, tctx));
		case "command": {
			const { command, env } = renderCommand(source.command, tctx);
			let stdout = "";
			const result = await runCommand({
				command,
				cwd: worktree,
				env,
				logPath: commandLogPath(ctx.dataDir, ctx.run.id, stepId),
				signal: ctx.signal(),
				onOutput: (stream, text) => {
					if (stream === "stdout") stdout += text;
				},
			});
			if (result.spawnError) {
				throw new Error(
					`The source command could not start: ${result.spawnError}`,
				);
			}
			if (result.exitCode !== 0) {
				throw new Error(
					`The source command failed. Its last output:\n${result.logTail}`,
				);
			}
			return parseCommandItems(stdout);
		}
	}
}
