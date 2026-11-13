/**
 * The authoring tools' port for a chat in the editor: the draft from the
 * request, the project's flows and runs as the Person sees them in the
 * Space, the profiles each Device of the Space offers a node, this
 * computer's CLI tools, connections and skills, and the place the draft
 * is checked in. Names and descriptions only: never a secret.
 */
import type {
	AuthoringPort,
	AuthoringRun,
	AuthoringRunStep,
	HistoryPort,
} from "@nightshift/agents";
import {
	type FlowRevisionItem,
	type RunDetail,
	type RunSummary,
	runReading,
	type SpaceEngine,
	type SpaceFlows,
	spaceSpend,
	type TranscriptEntry,
} from "@nightshift/engine";
import type { ProfileStore } from "@nightshift/engine/device-config";
import { isTestRun } from "@nightshift/engine/run-status";
import { type ChatRequest, isAgentProfile } from "@nightshift/flows";
import { now } from "@nightshift/time";
import { flowPlace, type PlaceDeps } from "./place";

/** What the ports read in the Space. */
type ChatSpace = Pick<SpaceEngine, "getRun" | "stepTranscript" | "listRuns"> & {
	flows: Pick<SpaceFlows, "map" | "revisions" | "revision">;
};

/** The chat's Space, and its Devices with the profiles a node may name. */
export type AuthoringSpace = ChatSpace & Pick<SpaceEngine, "listDevices">;

export type AuthoringPortDeps = PlaceDeps & {
	space: AuthoringSpace;
	profiles: Pick<ProfileStore, "list">;
	/** The skills the chat's harness can run in the project. */
	skills: () => Promise<
		{
			name: string;
			description: string | null;
			source: "project" | "computer";
		}[]
	>;
};

/** The port of one message: `get_run` only when the request names a run. */
export function authoringPort(
	deps: AuthoringPortDeps,
	request: ChatRequest,
	signal: AbortSignal,
): Omit<AuthoringPort, "propose"> {
	const { runId } = request;
	return {
		draft: async () => ({ name: request.flowName, flow: request.flow }),
		place: () => flowPlace(deps, request.projectId, request.flowName),
		flows: () => deps.space.flows.map(request.projectId),
		// Each Device's, with the settings of this computer's own.
		profiles: async () => {
			const own = new Map(deps.profiles.list().map((p) => [p.id, p]));
			const devices = await deps.space.listDevices(request.projectId);
			return devices.flatMap((device) =>
				(device.profiles ?? []).map((choice) => {
					const listed = {
						device: device.deviceId,
						profile: choice.id,
						name: choice.name,
						deviceName: device.name,
						kind: choice.kind,
					};
					const profile = device.thisDevice ? own.get(choice.id) : undefined;
					if (!profile) return listed;
					const description = profile.description ?? null;
					if (!isAgentProfile(profile)) {
						const { decider, model } = profile;
						return {
							...listed,
							decider,
							...(model ? { model } : {}),
							description,
						};
					}
					const { harness, model } = profile;
					return { ...listed, harness, model, description };
				}),
			);
		},
		tools: async () => ({
			clis: deps.cliTools.list().map((tool) => ({
				name: tool.name,
				description: tool.description,
				program: tool.program,
				signsIn: tool.login !== null,
			})),
			connections: deps.connections.list().map((connection) => ({
				name: connection.name,
				description: connection.description,
			})),
		}),
		skills: deps.skills,
		...(runId
			? {
					run: async () => {
						const detail = await deps.space.getRun(runId).catch(() => null);
						if (!detail || detail.projectId !== request.projectId) return null;
						return chatRun(deps.space, detail, signal);
					},
				}
			: {}),
	};
}

function costOf(
	of: Pick<
		RunSummary,
		"costUsd" | "costEstimated" | "costMissing" | "costCalls"
	> & { metrics?: RunSummary["metrics"] },
) {
	return {
		usd: of.costUsd,
		estimated: of.costEstimated,
		missing: of.costMissing,
		calls: of.costCalls,
		basis: of.metrics?.costBasis ?? null,
	};
}

function revisionOf(
	revision: FlowRevisionItem,
): Awaited<ReturnType<HistoryPort["revisions"]>> extends (infer R)[] | null
	? R
	: never {
	return {
		id: revision.id,
		at: revision.at,
		kind: revision.kind,
		by: revision.person?.name ?? null,
		current: revision.current,
		changes: revision.changes,
	};
}

const cents = (usd: number) => Math.round(usd * 100) / 100;

/**
 * The history tools' port for a chat in the editor: the runs, the cost
 * and the flow revisions of the chat's project, as the Person sees them
 * in the Space. It reads only, and only `request.projectId`: a run of
 * another project is no run, and a flow is looked up in this project.
 */
export function historyPort(
	space: ChatSpace,
	request: ChatRequest,
	signal: AbortSignal,
): HistoryPort {
	const { projectId } = request;
	/** The run when it is one of this project. */
	const runOf = async (runId: string) => {
		const detail = await space.getRun(runId).catch(() => null);
		return detail && detail.projectId === projectId ? detail : null;
	};
	const hasFlow = async (flow: string) =>
		flow in (await space.flows.map(projectId));
	return {
		flowName: request.flowName,
		...(request.runId ? { aboutRunId: request.runId } : {}),
		runs: async ({ flow, statuses, limit }) => {
			const runs = await space.listRuns({
				projectId,
				...(statuses ? { statuses } : {}),
			});
			return runs
				.filter((run) => flow === undefined || run.flowName === flow)
				.sort((a, b) => b.createdAt - a.createdAt)
				.slice(0, limit)
				.map((run) => ({
					id: run.id,
					flow: run.flowName,
					title: run.title,
					status: run.status,
					result: run.result,
					reason: run.reason,
					startedBy: run.trigger.kind,
					startedAt: run.createdAt,
					endedAt: run.endedAt,
					cost: costOf(run),
					...(isTestRun(run) ? { test: run.test } : {}),
				}));
		},
		run: async (runId) => {
			const detail = await runOf(runId);
			if (!detail) return null;
			const run = await chatRun(space, detail, signal);
			const flowOf = new Map(run.steps.map((step) => [step.id, step.flow]));
			return {
				run,
				flowName: detail.flowName,
				startedAt: detail.createdAt,
				endedAt: detail.endedAt,
				cost: costOf(detail),
				revisionId: detail.flowRevision,
				tokens: detail.metrics?.tokens ?? null,
				steps: detail.steps.map((step) => ({
					stepId: step.id,
					nodeId: step.nodeId,
					flow: flowOf.get(step.id) ?? null,
					visit: step.visit,
					usd: step.costUsd,
					estimated: step.costEstimated,
					missing: step.costMissing,
					calls: step.costCalls,
					ms: step.endedAt === null ? null : step.endedAt - step.startedAt,
					sessions: step.sessions.length,
				})),
			};
		},
		transcript: async (runId, named) => {
			const detail = await runOf(runId);
			const step =
				detail?.steps.find((each) => each.id === named) ??
				detail?.steps.findLast((each) => each.nodeId === named);
			if (!detail || !step) return null;
			const saved = await savedLines(space, detail.id, step.id, signal);
			return { nodeId: step.nodeId, ...saved };
		},
		spend: async (days) => {
			const spend = await spaceSpend(
				{ listRuns: () => space.listRuns({ projectId }) },
				{ now: now(), timeZone: "UTC" },
			);
			const range = spend.ranges.find((each) => each.nights === days);
			if (!range) return { days, runs: 0 };
			return {
				days,
				runs: range.runs,
				spentUsd: cents(range.total),
				spentInTheDaysBeforeUsd: cents(range.before),
				runsWithAnUnknownCost: range.unknown,
				couldSaveUsd: cents(range.saves),
				how: "A usual run is the median cost of a flow's finished runs. A costly run cost over twice a usual run. A run saves what it cost above a usual run, or all of it when it did not finish or found nothing to do.",
				flows: range.flows.map((flow) => ({
					flow: flow.flow,
					runs: flow.runs,
					spentUsd: cents(flow.spent),
					usualRunUsd: flow.usual
						? {
								median: cents(flow.usual.median),
								quarter: cents(flow.usual.q1),
								threeQuarters: cents(flow.usual.q3),
								most: cents(flow.usual.max),
								finishedRuns: flow.usual.count,
							}
						: null,
					costIs: flow.steadiness,
					couldSaveUsd: cents(flow.saves),
					steps: flow.steps.map((step) => ({
						node: step.via ? `${step.via}/${step.nodeId}` : step.nodeId,
						perRunUsd: cents(step.perRun),
						mostInOneRunUsd: cents(step.most),
						timesPerRun: Math.round(step.timesPerRun * 10) / 10,
					})),
				})),
				waysToSave: range.savings.map((saving) => ({
					flow: saving.flow,
					kind: saving.kind,
					savesUsd: cents(saving.saves),
					runs: saving.runs,
					ofRuns: saving.of,
					newestRun: saving.runId,
					...(saving.step
						? {
								stepWithMostExtraCost: saving.step.via
									? `${saving.step.via}/${saving.step.nodeId}`
									: saving.step.nodeId,
							}
						: {}),
				})),
				quickRuns: {
					runs: range.quick.runs,
					spentUsd: cents(range.quick.spent),
				},
			};
		},
		revisions: async (flow) => {
			if (!(await hasFlow(flow))) return null;
			return (await space.flows.revisions(projectId, flow)).map(revisionOf);
		},
		revision: async (flow, revisionId, against) => {
			if (!(await hasFlow(flow))) return null;
			const revisions = await space.flows.revisions(projectId, flow);
			const at = revisions.findIndex((each) => each.id === revisionId);
			if (at < 0) return null;
			// Newest first: the one before it comes after it in the list.
			const before =
				against !== undefined
					? revisions.find((each) => each.id === against)?.id
					: revisions[at + 1]?.id;
			if (against !== undefined && before === undefined) return null;
			if (before === undefined) {
				const view = await space.flows.revision(projectId, flow, revisionId);
				return {
					revision: revisionOf(view.revision),
					against: null,
					diff: null,
					flow: view.revision.flow,
				};
			}
			const view = await space.flows.revision(
				projectId,
				flow,
				revisionId,
				before,
			);
			return {
				revision: revisionOf(view.revision),
				against: before,
				diff: view.diff,
				flow: view.revision.flow,
			};
		},
	};
}

/** How long the read of the failed step's transcript may take in all. */
const TRANSCRIPT_MS = 10_000;

/**
 * The run for the chat, from its detail: each step with the called flow
 * it ran in, the step the run failed at (`runReading`), and the end of
 * that step's saved transcript in plain text.
 */
export async function chatRun(
	space: Pick<SpaceEngine, "stepTranscript">,
	detail: RunDetail,
	signal: AbortSignal,
): Promise<AuthoringRun> {
	const { flowOf, failedStep } = runReading(detail);
	const steps: AuthoringRunStep[] = detail.steps.map((step) => {
		const note = step.outputs.note ?? step.outputs.summary;
		return {
			id: step.id,
			flow: flowOf.get(step.id) ?? null,
			nodeId: step.nodeId,
			nodeType: step.nodeType,
			visit: step.visit,
			outcome: step.outcome,
			error: step.error,
			note: typeof note === "string" && note.trim() !== "" ? note : null,
			...(step.test ? { test: step.test } : {}),
		};
	});
	const transcript = failedStep
		? await savedLines(space, detail.id, failedStep.id, signal)
		: null;
	return {
		id: detail.id,
		status: detail.status,
		reason: detail.reason,
		...(isTestRun(detail) ? { test: detail.test } : {}),
		inputs: detail.inputs,
		flow: detail.flow,
		steps,
		failedStepId: failedStep?.id ?? null,
		transcript: transcript?.lines ?? [],
		...(transcript && transcript.holds !== "whole"
			? { transcriptHolds: transcript.holds }
			: {}),
	};
}

/** At most this many lines of a step's transcript are kept: the last ones. */
const TRANSCRIPT_LINES = 300;

const cut = (text: string, max: number) =>
	text.length > max ? `${text.slice(0, max - 1)}…` : text;

/**
 * The last lines of one step's saved transcript, in plain text, and how
 * much of the transcript they come from. A read that takes longer than
 * `TRANSCRIPT_MS` keeps what came, and a read that fails keeps nothing:
 * both are `cut`.
 */
async function savedLines(
	space: Pick<SpaceEngine, "stepTranscript">,
	runId: string,
	stepId: string,
	signal: AbortSignal,
): Promise<{ lines: string[]; holds: "whole" | "so-far" | "cut" }> {
	const read = await space
		.stepTranscript(
			runId,
			stepId,
			AbortSignal.any([signal, AbortSignal.timeout(TRANSCRIPT_MS)]),
		)
		.catch(() => ({ entries: [], holds: "cut" as const }));
	const lines: string[] = [];
	let text = "";
	const push = (line: string) => {
		if (text !== "") {
			lines.push(...text.trim().split("\n"));
			text = "";
		}
		if (line !== "") lines.push(line);
		if (lines.length > TRANSCRIPT_LINES * 2) {
			lines.splice(0, lines.length - TRANSCRIPT_LINES);
		}
	};
	for (const { event } of read.entries) {
		if (event.type === "text") text += event.delta;
		else push(lineOf(event));
	}
	push("");
	return { lines: lines.slice(-TRANSCRIPT_LINES), holds: read.holds };
}

/** One transcript event as a line. Empty: not worth a line. */
function lineOf(event: TranscriptEntry["event"]): string {
	switch (event.type) {
		case "tool-end":
			return `> ${event.name} ${cut(JSON.stringify(event.input ?? {}), 200)}`;
		case "tool-result":
			return `${event.isError ? "tool error: " : ""}${cut(event.content.trim(), 300)}`;
		case "report":
			return `Report (${event.outcome || "no outcome"}): ${cut(event.summary, 500)}`;
		case "error":
			return `Error: ${event.message}`;
		case "command-start":
			return `$ ${event.command}`;
		case "command-output":
			return event.text.trimEnd();
		case "command-exit":
			return `Exit code: ${event.exitCode ?? "none"}`;
		case "decision":
			return `Decision: ${event.label}. ${cut(event.notes, 300)}`;
		case "gate-resolved":
			return `Answer: ${event.choice}${event.note ? `. ${event.note}` : ""}`;
		case "value":
			return event.problem ? `Value problem: ${event.problem}` : "";
		case "convert":
			return event.problem
				? `Convert ${event.from} to ${event.to} failed: ${event.problem}`
				: `Converted ${event.from} to ${event.to} (${event.bytes} bytes)`;
		case "tool-called":
			return `${event.isError ? "tool error: " : ""}${cut(event.text, 300)}`;
		case "wait":
			return `Waits: ${event.message}`;
		case "item-end":
			return event.reason ? `Item ${event.state}: ${event.reason}` : "";
		case "end":
			return `End: ${event.status}${event.message ? `. ${event.message}` : ""}`;
		case "service":
			return event.state === "starting"
				? `Service: start ${event.command ?? ""}`.trim()
				: event.state === "ready"
					? "Service: ready"
					: `Service: failed${event.reason ? `. ${event.reason}` : ""}`;
		case "lease":
			return event.held
				? `Lease: took ${event.name}`
				: `Lease: ${event.name} is held by run ${event.holder ?? "unknown"}`;
		case "since-last-run":
			return `Since last run: ${event.new} new, ${event.changed} changed, ${event.same} the same${event.firstRun ? " (first run)" : ""}${event.remembers ? "" : ", remembers nothing"}`;
		case "web-request":
			return `Web request: ${event.method} ${cut(event.url, 300)}`;
		case "web-response":
			return event.status === null
				? `Web response: none. ${event.text}`
				: `Web response: ${event.status} ${event.text}`.trim();
		// Not worth a line: the text and the thinking come as deltas, the
		// rest is the start of what a line above shows, or bookkeeping.
		case "text":
		case "thinking":
		case "session":
		case "tool-start":
		case "usage":
		case "finished":
		case "decision-start":
		case "rule":
		case "gate-open":
		case "items-read":
		case "item-start":
		case "wake":
		case "value-start":
		case "tool-call":
		case "worktree-snapshot":
		case "worktree-changes":
			return "";
		default:
			return unknownKind(event);
	}
}

/**
 * An event kind this build does not know, from a newer Night Shift: no
 * line. Its type is `never`, so a kind added to `StepEvent` fails to
 * compile until `lineOf` gives it words or none.
 */
function unknownKind(_event: never): string {
	return "";
}
