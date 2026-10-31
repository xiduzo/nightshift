/**
 * The authoring tools' port for a chat in the editor: the draft from the
 * request, the project's flows and runs as the Person sees them in the
 * Space, the profiles each Device of the Space offers a node, and this
 * computer's CLI tools, connections and skills. Names and descriptions
 * only: never a secret.
 */
import type {
	AuthoringPort,
	AuthoringRun,
	AuthoringRunStep,
} from "@nightshift/agents";
import type {
	SpaceEngine,
	SpaceFlows,
	TranscriptEntry,
} from "@nightshift/engine";
import type {
	CliToolStore,
	ConnectionStore,
	ProfileStore,
} from "@nightshift/engine/device-config";
import { type ChatRequest, isAgentProfile } from "@nightshift/flows";

/** What the port reads in the Space. */
export type ChatSpace = Pick<SpaceEngine, "getRun" | "watchRun"> & {
	flows: Pick<SpaceFlows, "map">;
};

/** The chat's Space, and its Devices with the profiles a node may name. */
export type AuthoringSpace = ChatSpace & Pick<SpaceEngine, "listDevices">;

export type AuthoringPortDeps = {
	space: AuthoringSpace;
	profiles: Pick<ProfileStore, "list">;
	cliTools: Pick<CliToolStore, "list">;
	connections: Pick<ConnectionStore, "list">;
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
					run: () => chatRun(deps.space, request.projectId, runId, { signal }),
				}
			: {}),
	};
}

/** Step outcomes that end a run badly. */
const BAD = new Set(["fail", "needs-input", "error", "stopped", "interrupted"]);

/** How long the transcript read waits for more after the last entry, and in all. */
export type TranscriptTimes = { idleMs?: number; totalMs?: number };

/**
 * The run for the chat, or null when the Space has no run of that id in
 * this project. The failed step is the last one that ended badly, inside
 * the flows it called: a step in a called flow, not the Subflow step that
 * failed because of it. Each step names the called flow it ran in.
 */
export async function chatRun(
	space: ChatSpace,
	projectId: string,
	runId: string,
	options: { signal: AbortSignal } & TranscriptTimes,
): Promise<AuthoringRun | null> {
	const detail = await space.getRun(runId).catch(() => null);
	if (!detail || detail.projectId !== projectId) return null;
	const byId = new Map(detail.steps.map((step) => [step.id, step]));
	const flowOf = new Map<string, string | null>();
	/** The called flow a step ran in: the `flow` of its parent's Subflow node. */
	const calledFlow = (stepId: string, depth = 0): string | null => {
		const known = flowOf.get(stepId);
		if (known !== undefined) return known;
		const step = byId.get(stepId);
		const parent = step?.scope ? byId.get(step.scope.parentStepId) : null;
		let name: string | null = null;
		if (parent && depth < 20) {
			const outer = calledFlow(parent.id, depth + 1);
			const flow = outer ? detail.calledFlows[outer] : detail.flow;
			const node = flow?.nodes.find((n) => n.id === parent.nodeId);
			name = node?.type === "call" ? node.flow : null;
		}
		flowOf.set(stepId, name);
		return name;
	};
	const steps: AuthoringRunStep[] = detail.steps.map((step) => {
		const note = step.outputs.note ?? step.outputs.summary;
		return {
			id: step.id,
			flow: calledFlow(step.id),
			nodeId: step.nodeId,
			nodeType: step.nodeType,
			visit: step.visit,
			outcome: step.outcome,
			error: step.error,
			note: typeof note === "string" && note.trim() !== "" ? note : null,
		};
	});
	const bad = detail.steps.filter(
		(step) =>
			step.error !== null || (step.outcome !== null && BAD.has(step.outcome)),
	);
	// A Subflow step that failed because a step inside it did is not the cause.
	const parents = new Set(
		bad.flatMap((step) => (step.scope ? [step.scope.parentStepId] : [])),
	);
	const failed =
		[...bad].reverse().find((step) => !parents.has(step.id)) ?? null;
	return {
		id: detail.id,
		status: detail.status,
		reason: detail.reason,
		inputs: detail.inputs,
		flow: detail.flow,
		steps,
		failedStepId: failed?.id ?? null,
		transcript: failed
			? await stepTranscript(space, runId, failed.id, options)
			: [],
	};
}

/** At most this many lines of a step's transcript are kept: the last ones. */
const TRANSCRIPT_LINES = 300;

const cut = (text: string, max: number) =>
	text.length > max ? `${text.slice(0, max - 1)}…` : text;

/**
 * The last lines of one step's transcript, in plain text. It reads the
 * run's saved transcript, and stops once nothing new comes for `idleMs`
 * (the replay is done) or after `totalMs`.
 */
export async function stepTranscript(
	space: Pick<SpaceEngine, "watchRun">,
	runId: string,
	stepId: string,
	options: { signal: AbortSignal } & TranscriptTimes,
): Promise<string[]> {
	const idleMs = options.idleMs ?? 750;
	const totalMs = options.totalMs ?? 5_000;
	const controller = new AbortController();
	const stop = () => controller.abort();
	options.signal.addEventListener("abort", stop, { once: true });
	const total = setTimeout(stop, totalMs);
	let idle: ReturnType<typeof setTimeout> | null = null;
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
	try {
		for await (const item of space.watchRun(runId, {
			signal: controller.signal,
		})) {
			if (idle) clearTimeout(idle);
			idle = setTimeout(stop, idleMs);
			if (item.kind !== "transcript" || item.entry.stepId !== stepId) continue;
			const event = item.entry.event;
			if (event.type === "text") text += event.delta;
			else push(lineOf(event));
		}
	} catch {
		// Aborted, or the transcript could not be read: keep what came.
	} finally {
		clearTimeout(total);
		if (idle) clearTimeout(idle);
		options.signal.removeEventListener("abort", stop);
	}
	push("");
	return lines.slice(-TRANSCRIPT_LINES);
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
		case "tool-called":
			return `${event.isError ? "tool error: " : ""}${cut(event.text, 300)}`;
		case "wait":
			return `Waits: ${event.message}`;
		case "item-end":
			return event.reason ? `Item ${event.state}: ${event.reason}` : "";
		case "end":
			return `End: ${event.status}${event.message ? `. ${event.message}` : ""}`;
		case "lease":
			return event.held
				? `Lease: took ${event.name}`
				: `Lease: ${event.name} is held by run ${event.holder ?? "unknown"}`;
		default:
			return "";
	}
}
