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
} from "@nightshift/agents";
import {
	type RunDetail,
	runReading,
	type SpaceEngine,
	type SpaceFlows,
	type TranscriptEntry,
} from "@nightshift/engine";
import type { ProfileStore } from "@nightshift/engine/device-config";
import { isTestRun } from "@nightshift/engine/run-status";
import { type ChatRequest, isAgentProfile } from "@nightshift/flows";
import { flowPlace, type PlaceDeps } from "./place";

/** What the port reads in the Space. */
type ChatSpace = Pick<SpaceEngine, "getRun" | "stepTranscript"> & {
	flows: Pick<SpaceFlows, "map">;
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
