/**
 * SPIKE. Runs compiled flows: start a run, resume one that parked, read its
 * state and history. The thread id is the run id. A new runner over the
 * same database continues where the old one stopped (a daemon restart).
 */
import { Command } from "@langchain/langgraph";
import type { Client } from "@libsql/client";
import type { Flow } from "@nightshift/flows";

import { LibsqlSaver } from "./checkpointer";
import {
	compileFlow,
	type Parked,
	type RunEvent,
	type RunStateValues,
	type Services,
} from "./compile";

/** One item of a run's stream: a step event, or the run parking. */
export type StreamItem =
	| { kind: "event"; event: RunEvent }
	| { kind: "update"; node: string; update: Partial<RunStateValues> }
	| { kind: "parked"; parked: Parked };

export function createRunner(input: {
	client: Client;
	services: Omit<Services, "run">;
}) {
	const saver = new LibsqlSaver(input.client);

	function graphFor(runId: string, flow: Flow) {
		const services: Services = {
			...input.services,
			run: {
				branch: `nightshift/${runId}`,
				base_branch: "main",
				index: "1",
				worktree: input.services.cwd,
				base_ref: "",
				flow: "spike",
			},
		};
		return compileFlow(flow, services).compile({ checkpointer: saver });
	}

	const config = (runId: string) => ({ configurable: { thread_id: runId } });

	async function* drive(
		runId: string,
		flow: Flow,
		start: Parameters<ReturnType<typeof graphFor>["stream"]>[0],
	): AsyncGenerator<StreamItem> {
		const graph = graphFor(runId, flow);
		const stream = await graph.stream(start, {
			...config(runId),
			streamMode: ["updates", "custom"],
			// Events from subgraphs (Subflow, For Each bodies) too.
			subgraphs: true,
		});
		for await (const chunk of stream) {
			// With subgraphs, each chunk is [namespace, mode, data].
			const [namespace, mode, data] = chunk as [string[], string, unknown];
			if (mode === "custom") {
				yield { kind: "event", event: data as RunEvent };
				continue;
			}
			for (const [node, update] of Object.entries(
				data as Record<string, unknown>,
			)) {
				if (node === "__interrupt__") {
					// A body's interrupt surfaces in every namespace up to the root.
					if (namespace.length > 0) continue;
					const [first] = update as { value: Parked }[];
					if (first) yield { kind: "parked", parked: first.value };
				} else {
					yield {
						kind: "update",
						node,
						update: update as Partial<RunStateValues>,
					};
				}
			}
		}
	}

	return {
		start(runId: string, flow: Flow, inputs: Record<string, unknown> = {}) {
			return drive(runId, flow, { inputs });
		},
		/** Continues a parked run: a wait (`{ prompt? }`) or a Gate (the choice). */
		resume(runId: string, flow: Flow, value: unknown) {
			// `undefined` would be an empty command; a wait resumes on `{}`.
			return drive(runId, flow, new Command({ resume: value ?? {} }));
		},
		async state(runId: string, flow: Flow) {
			const snapshot = await graphFor(runId, flow).getState(config(runId));
			return {
				values: snapshot.values as RunStateValues,
				next: snapshot.next,
				parked: (snapshot.tasks.flatMap((t) => t.interrupts)[0]?.value ??
					null) as Parked | null,
				checkpointId: snapshot.config.configurable?.checkpoint_id as string,
			};
		},
		/** Every checkpoint of the run, newest first. */
		async history(runId: string, flow: Flow) {
			const out: { checkpointId: string; next: string[]; steps: number }[] = [];
			for await (const s of graphFor(runId, flow).getStateHistory(
				config(runId),
			)) {
				out.push({
					checkpointId: s.config.configurable?.checkpoint_id as string,
					next: [...s.next],
					steps: (s.values as RunStateValues).steps?.length ?? 0,
				});
			}
			return out;
		},
		/** Runs again from an earlier checkpoint, as a fork of the thread. */
		fork(runId: string, flow: Flow, checkpointId: string) {
			const graph = graphFor(runId, flow);
			return graph.stream(null, {
				configurable: { thread_id: runId, checkpoint_id: checkpointId },
				streamMode: "updates",
			});
		},
	};
}
