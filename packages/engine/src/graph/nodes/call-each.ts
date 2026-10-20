import { Command } from "@langchain/langgraph";
import {
	blockersFirst,
	type CallEachNode,
	type ListItem,
	newlyBlocked,
	nextItem,
	renderCommand,
	renderTemplate,
	type TemplateContext,
	unfinishedBlockers,
} from "@nightshift/flows";

import { runCommand } from "../../device";
import {
	commandLogPath,
	type EnginePayloads,
	type InputValues,
	type ItemFacts,
	type LoggedEvent,
	type Scope,
	type StepOutcome,
	type StepOutputs,
} from "../../log";
import { itemBranchName } from "../../projects";
import {
	type DerivedStep,
	deriveSteps,
	deriveStopAfterStep,
	itemStates,
} from "../../read";
import {
	messageOf,
	type NodeAction,
	STOP_AFTER_STEP_REASON,
	STOP_TIME_REASON,
	type StepContext,
	stopAtOf,
} from "../context";
import {
	eachOutputs,
	fileItems,
	itemLabel,
	jsonSourceItems,
	parseCommandItems,
	toItemFacts,
} from "../each";
import { renderBindings, resolveInputs } from "../inputs";
import { entryOf, RESUME_RULES, resumePoint } from "../resume-point";
import { parkCommand, route, type StepEnd, scopeOf } from "../route";
import type { Loop } from "../state";
import { beginStep, readyDevice, type StepHandle } from "../step-runner";
import {
	type BodyGraph,
	bodyGraph,
	bodyOutputs,
	hasStoppedEdge,
	runBody,
} from "./body";

/**
 * A Call node with `each`: the per-element loop of `callNode`, ported from
 * `runForEachStep` in engine.ts (design rule 13). One element per
 * super-step: the node reads its source again,
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
 *
 * How the node enters is the one resume point (`resumePoint`,
 * `RESUME_RULES.callEach`): a run parked at this node's own park node (a
 * stop between elements, or the step ended `error`) reopens the step and
 * goes on with the loop; an ended visit with an exhausted edge starts a new
 * one. Mid-loop (`state.loops` set) the open step continues. Else the step
 * the log has that the graph never committed (the first element was
 * running) is continued or reopened; else a new visit.
 *
 * The node opens its step through the step runner's lower seam
 * (`beginStep`, `OpenStep`), not `runStep`: one step spans many
 * super-steps, and the entry checks between elements are the loop's own.
 */
export function callEachNode(node: CallEachNode, ctx: StepContext): NodeAction {
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
			entryOf(resumePoint(node, state, events, scope, RESUME_RULES.callEach)),
			events,
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
			const waiting = lastRead
				.filter((item) => !item.done && !Object.hasOwn(states, item.id))
				.map((item) => ({
					id: item.id,
					blockers: unfinishedBlockers(item, lastRead, states),
				}));
			return step.end(
				outcome,
				eachOutputs({ items: derived.items, visit, outcome, waiting }),
				error,
			);
		};
		const finish = async (outcome: StepOutcome, error: string | null) =>
			route(ctx, state, node, await endStep(outcome, error), config, {
				loops: { [node.id]: null },
			});
		// Its item branches and its source work in the worktree: the run's
		// work moves to this step's Device first.
		const ready = await readyDevice(ctx, node, step);
		if (ready?.kind === "end") return finish("error", ready.error);
		if (ready?.kind === "offline") {
			return finish(
				"error",
				`${ready.name} is offline. Resume the run when it is back.`,
			);
		}
		/** The step ends `stopped` and the run parks here with the stop's reason (null for a person's stop). */
		const parkStopped = async (reason: string | null) => {
			const end = await endStep("stopped", null);
			return parkCommand({
				node,
				status: "stopped",
				reason,
				step: end,
				atStopTime: reason === STOP_TIME_REASON,
				update: {
					loops: { [node.id]: null },
					nodes: { [node.id]: end.outputs },
					visits: { [node.id]: visit },
				},
			});
		};
		/**
		 * The stop time ended the loop, and the node has a `stopped` edge: the
		 * step ends `stopped` and the run goes on along the edge, past the
		 * stop time, to the nodes that wrap it up.
		 */
		const wrapUp = async () =>
			route(ctx, state, node, await endStep("stopped", null), config, {
				loops: { [node.id]: null },
				wrappingUp: true,
			});
		const wrapsUp = hasStoppedEdge(ctx.flow, node);
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
		const { each } = node;
		const as = each.as ?? "item";
		const haltOn = each.haltOn ?? ["halt"];
		const perItem = (each.branch ?? "per-item") === "per-item";
		const worktree = step.worktree;

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
			const stop = stopBeforeNext(
				ctx,
				stopAtOf(state, config),
				await ctx.log.events(runId),
			);
			if (stop === STOP_TIME_REASON && wrapsUp) return wrapUp();
			if (stop) return parkStopped(stop);

			let items: ListItem[];
			try {
				items = await readSource(ctx, node, tctx, step);
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
			if (each.maxItems !== undefined && started >= each.maxItems) {
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
					// The worktree is on the step's Device: so is the git work.
					const made = await step.device.itemBranch({
						cwd: worktree,
						name: itemBranchName(runId.slice(0, 8), facts),
						base:
							derived.items.findLast((i) => i.state === "done" && i.branch)
								?.branch ??
							derived.items.find((i) => i.index !== null)?.baseBranch ??
							null,
						fallback: tctx.run.branch,
					});
					baseBranch = made.base;
					branch = made.branch;
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
		const ended = await runBody({
			graph,
			config,
			stopAt: stopAtOf(state, config),
			...body,
		});
		switch (ended.kind) {
			case "paused":
				// The step stays open: the element continues after the wait.
				step.leaveOpen();
				throw ended.interrupt;
			case "stopped": {
				if (ended.atStopTime && wrapsUp) {
					const outputs = await bodyOutputs(ctx, body);
					await endItem(
						element.facts.id,
						"failed",
						"Not finished before the stop time.",
						outputs,
					);
					return wrapUp();
				}
				await endStep("stopped", null);
				throw ended.interrupt;
			}
			case "aborted":
				await endStep("error", ended.reason);
				throw ended.interrupt;
			case "failed": {
				const outputs = await bodyOutputs(ctx, body);
				await endItem(element.facts.id, "failed", ended.reason, outputs);
				return next(element);
			}
			case "finished": {
				const outputs = await bodyOutputs(ctx, body, ended);
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

/** Why the loop must stop before the next element, or null. */
function stopBeforeNext(
	ctx: StepContext,
	stopAt: number | null,
	events: readonly LoggedEvent[],
): string | null {
	if (deriveStopAfterStep(events)) return STOP_AFTER_STEP_REASON;
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
	node: CallEachNode,
	tctx: TemplateContext,
	step: StepHandle,
): Promise<ListItem[]> {
	const worktree = step.worktree;
	const source = node.each.source;
	switch (source.kind) {
		case "json":
			return jsonSourceItems(source.value, tctx);
		case "files":
			return fileItems(renderTemplate(source.glob, tctx), (glob) =>
				step.device.files({ cwd: worktree, glob }),
			);
		case "command": {
			const { command, env } = renderCommand(source.command, tctx);
			let stdout = "";
			const result = await runCommand(step.device, {
				command,
				cwd: worktree,
				env,
				logPath: commandLogPath(ctx.dataDir, ctx.run.id, step.stepId),
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
