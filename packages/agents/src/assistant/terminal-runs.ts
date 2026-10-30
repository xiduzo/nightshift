/**
 * The run side of `nightshift mcp`: what an agent or an orchestrator needs
 * to drive a night. List and read runs, stop one, see the Gates that wait
 * for a person and answer one, and read what happened since a time. The
 * tools read and write through the same procedures as the web app, over a
 * `TerminalRunPort`.
 */
import type { ProjectFlowMap } from "@nightshift/flows";
import { toolDefinition } from "@tanstack/ai";
import type { BridgedTool } from "../port";
import type { TerminalProject } from "./terminal-project";
import { AUTHORING_TOOLS, type AuthoringRun, field, runReport } from "./tools";

/** The names of the run tools only the terminal has. */
export const RUN_TOOLS = {
	listRuns: "list_runs",
	stopRun: "stop_run",
	needsMe: "needs_me",
	answerGate: "answer_gate",
	getDigest: "get_digest",
} as const;

/** The statuses a run can have, as `list_runs` filters them. */
const RUN_STATUSES = [
	"running",
	"waiting",
	"sleeping",
	"finished",
	"failed",
	"stopped",
	"interrupted",
] as const;

export type TerminalRunStatus = (typeof RUN_STATUSES)[number];

/** What a run cost, as Night Shift knows it. */
export type TerminalCost = {
	usd: number;
	/** Part of it is priced from tokens. */
	estimated: boolean;
	/** How many calls did not say what they cost. */
	missing: number;
	/** How many calls could cost. */
	calls: number;
	/** How sure the cost is, when the run's metrics say. */
	basis: "billed" | "estimated" | "unknown" | null;
};

/** A run in the list of `list_runs`. */
export type TerminalRunSummary = {
	id: string;
	flowName: string | null;
	title: string;
	status: string;
	reason: string | null;
	/** Epoch ms. */
	createdAt: number;
	/** Epoch ms. Null while it goes on. */
	endedAt: number | null;
	cost: TerminalCost;
	/** The pull request the run opened. */
	prUrl: string | null;
};

/** A Gate that waits for a person, as the Needs-you inbox shows it. */
export type TerminalGate = {
	runId: string;
	stepId: string;
	projectId: string;
	projectName: string;
	flowName: string | null;
	runTitle: string;
	/** The question, as the flow wrote it for this run. */
	question: string;
	choices: { name: string; description?: string; needsNote?: true }[];
	/** Epoch ms. */
	openedAt: number;
	/** When nobody answers by `at`, Night Shift takes `choose`. */
	deadline: { at: number; choose: string } | null;
	/** Your role in the Gate's Space lets you answer it. */
	canAnswer: boolean;
	/** An answer is on its way. */
	answerPending: boolean;
};

/** A digest: the runs that ended in a window, and the Gates that wait now. */
export type TerminalDigest = {
	/** Epoch ms. */
	from: number;
	/** "3 runs finished, 1 failed. $4.20 spent. 1 Gate waits for you." */
	body: string;
	/** Newest first. */
	runs: {
		runId: string;
		title: string;
		/** "Finished", "Nothing to do", "Failed", "Stopped". */
		statusText: string;
		/** The cost, why it ended, what went wrong. */
		detail: string | null;
		prUrl: string | null;
	}[];
	gates: { runId: string; stepId: string; title: string }[];
};

/** What the run tools read and do: Night Shift on this computer. */
export type TerminalRunPort = {
	flows(projectId: string): Promise<ProjectFlowMap>;
	/** The newest runs of the project first, only of these statuses when given. */
	runs(
		projectId: string,
		query: { limit: number; statuses?: TerminalRunStatus[] },
	): Promise<TerminalRunSummary[]>;
	/** One run of the project, or null when it has no run of that id. */
	run(
		projectId: string,
		runId: string,
	): Promise<{
		run: AuthoringRun;
		flowName: string | null;
		cost: TerminalCost;
		prUrl: string | null;
	} | null>;
	/** Stops a run now, or after the step that runs now. */
	stopRun(runId: string, when: "now" | "after-step"): Promise<void>;
	/** The open Gates of every Space you are in, oldest first. */
	gates(): Promise<TerminalGate[]>;
	answerGate(answer: {
		runId: string;
		stepId: string;
		choice: string;
		note?: string;
	}): Promise<void>;
	/** The digest since `since` (epoch ms), or since your last digest. Null: nothing to say. */
	digest(since?: number): Promise<TerminalDigest | null>;
	/** Where a person opens the run, at the step when given. */
	runLink(runId: string, stepId?: string): string;
};

const RUNS_DEFAULT = 10;
const RUNS_MAX = 50;

const projectProperty = {
	type: "string",
	description:
		"The project: its id or name from list_projects. Leave it out for the project of the folder you work in.",
};

const sinceProperty = {
	type: "string",
	description:
		"A time: an ISO date or time (2026-10-30, 2026-10-30T07:00:00Z), or a span back from now (12h, 2d, 30m).",
};

const SPAN = /^(\d+(?:\.\d+)?)\s*(m|h|d)$/i;
const SPAN_MS = { m: 60_000, h: 60 * 60_000, d: 24 * 60 * 60_000 } as const;

/** Epoch ms of a `since` argument. Undefined: none given. Throws in plain words on a value it cannot read. */
export function sinceOf(value: unknown, now: number): number | undefined {
	if (value === undefined || value === null || value === "") return undefined;
	if (typeof value === "string") {
		const span = SPAN.exec(value.trim());
		if (span) {
			const unit = (span[2] as string).toLowerCase() as keyof typeof SPAN_MS;
			return now - Number(span[1]) * SPAN_MS[unit];
		}
		const at = Date.parse(value);
		if (!Number.isNaN(at)) return at;
	}
	throw new Error(
		"Give `since` as an ISO date or time (2026-10-30T07:00:00Z) or a span back from now (12h, 2d).",
	);
}

function dollars(usd: number): string {
	return `$${usd.toFixed(2)}`;
}

/** What a run cost, with how sure it is. Null: nothing in it could cost. */
export function costText(cost: TerminalCost): string | null {
	if (cost.calls === 0 && cost.usd === 0) return null;
	const basis =
		cost.basis ??
		(cost.missing > 0 ? "unknown" : cost.estimated ? "estimated" : "billed");
	switch (basis) {
		case "unknown":
			return cost.usd > 0 ? `at least ${dollars(cost.usd)}` : "cost unknown";
		case "estimated":
			return `about ${dollars(cost.usd)}`;
		case "billed":
			return dollars(cost.usd);
	}
}

const iso = (at: number | null) =>
	at === null ? null : new Date(at).toISOString();

/** A Gate's id for the agent: its run and its step. */
export function gateIdOf(gate: { runId: string; stepId: string }): string {
	return `${gate.runId}:${gate.stepId}`;
}

function parseGateId(value: unknown): { runId: string; stepId: string } {
	const text = typeof value === "string" ? value.trim() : "";
	const at = text.indexOf(":");
	if (at <= 0 || at === text.length - 1) {
		throw new Error(
			`Give the Gate's id in \`gate\`, as ${RUN_TOOLS.needsMe} gives it.`,
		);
	}
	return { runId: text.slice(0, at), stepId: text.slice(at + 1) };
}

function statusesOf(value: unknown): TerminalRunStatus[] | undefined {
	if (value === undefined || value === null || value === "") return undefined;
	const given = Array.isArray(value) ? value : [value];
	const known = new Set<string>(RUN_STATUSES);
	const wrong = given.filter((s) => typeof s !== "string" || !known.has(s));
	if (wrong.length > 0 || given.length === 0) {
		throw new Error(
			`Give \`status\` as one or more of: ${RUN_STATUSES.join(", ")}.`,
		);
	}
	return given as TerminalRunStatus[];
}

/** The run tools over `port`, in the project `projectOf` finds for a call. */
export function terminalRunTools(
	port: TerminalRunPort,
	projectOf: (args: unknown) => Promise<TerminalProject>,
	now: () => number = Date.now,
): BridgedTool[] {
	return [
		toolDefinition({
			name: RUN_TOOLS.listRuns,
			description:
				"The newest runs of the project: id, flow, title, status, why it ended, when it started and ended, its cost and the pull request it opened. Filter by status and by start time. Use it to see what ran, and to find a run's id for get_run or stop_run.",
			inputSchema: {
				type: "object",
				properties: {
					project: projectProperty,
					status: {
						description: `Only runs with this status, or one of these. Statuses: ${RUN_STATUSES.join(", ")}. A run is waiting while a Gate waits for a person.`,
						anyOf: [
							{ type: "string", enum: [...RUN_STATUSES] },
							{
								type: "array",
								items: { type: "string", enum: [...RUN_STATUSES] },
							},
						],
					},
					since: {
						...sinceProperty,
						description: `Only runs that started at or after this time. ${sinceProperty.description}`,
					},
					limit: {
						type: "number",
						description: `At most this many runs. Default ${RUNS_DEFAULT}, at most ${RUNS_MAX}.`,
					},
				},
			},
		}).server(async (args: unknown) => {
			const limit = field(args, "limit");
			const count =
				typeof limit === "number" && Number.isInteger(limit) && limit > 0
					? Math.min(limit, RUNS_MAX)
					: RUNS_DEFAULT;
			const statuses = statusesOf(field(args, "status"));
			const since = sinceOf(field(args, "since"), now());
			const project = await projectOf(args);
			// Newest first: the newest of the page that started since are the newest since.
			const runs = (
				await port.runs(project.id, {
					limit: count,
					...(statuses ? { statuses } : {}),
				})
			).filter((run) => since === undefined || run.createdAt >= since);
			if (runs.length === 0) {
				return since === undefined && !statuses
					? `The project "${project.name}" has no runs yet.`
					: `The project "${project.name}" has no runs like that.`;
			}
			return JSON.stringify(
				runs.map(({ cost, ...run }) => ({
					...run,
					createdAt: iso(run.createdAt),
					endedAt: iso(run.endedAt),
					cost: costText(cost),
				})),
				null,
				2,
			);
		}),
		toolDefinition({
			name: AUTHORING_TOOLS.getRun,
			description:
				"One run of the project: its status, why it ended, its cost, the pull request it opened, its steps with their outcomes and notes, and the end of the failed step's transcript. Use it to follow a run you started, or to see why one failed.",
			inputSchema: {
				type: "object",
				properties: {
					project: projectProperty,
					run: {
						type: "string",
						description: "The run's id, from list_runs.",
					},
				},
				required: ["run"],
			},
		}).server(async (args: unknown) => {
			const runId = field(args, "run");
			if (typeof runId !== "string" || runId.trim() === "") {
				throw new Error("Give the run's id in `run`.");
			}
			const project = await projectOf(args);
			const found = await port.run(project.id, runId.trim());
			if (!found) {
				return `The project "${project.name}" has no run ${runId}. Call ${RUN_TOOLS.listRuns} for the ids.`;
			}
			const flows = found.flowName ? await port.flows(project.id) : {};
			const now = found.flowName ? flows[found.flowName] : null;
			const report = now
				? runReport(found.run, now, `The saved flow "${found.flowName}"`)
				: runReport(found.run, found.run.flow, "The run's own flow");
			const cost = costText(found.cost);
			const facts = [
				...(cost ? [`Cost: ${cost}`] : []),
				...(found.prUrl ? [`Pull request: ${found.prUrl}`] : []),
				`Open it at ${port.runLink(found.run.id)}`,
			];
			// The facts go under the status line, before the steps.
			const lines = report.split("\n");
			const status = lines.findIndex((line) => line.startsWith("Status:"));
			lines.splice(status + 1, 0, ...facts);
			return lines.join("\n");
		}),
		toolDefinition({
			name: RUN_TOOLS.stopRun,
			description:
				"Stop a run: now, or after the step that runs now. A stopped run does not go on. Stop a run only when the person asked you to.",
			inputSchema: {
				type: "object",
				properties: {
					run: {
						type: "string",
						description: "The run's id, from list_runs.",
					},
					when: {
						type: "string",
						enum: ["now", "after-step"],
						description:
							"now: stop it at once. after-step: let the step that runs now end first. Default now.",
					},
				},
				required: ["run"],
			},
		}).server(async (args: unknown) => {
			const runId = field(args, "run");
			if (typeof runId !== "string" || runId.trim() === "") {
				throw new Error("Give the run's id in `run`.");
			}
			const when = field(args, "when") ?? "now";
			if (when !== "now" && when !== "after-step") {
				throw new Error("Give `when` as now or after-step.");
			}
			await port.stopRun(runId.trim(), when);
			return when === "now"
				? `Night Shift stops run ${runId.trim()} now.`
				: `Run ${runId.trim()} stops when the step that runs now ends.`;
		}),
		toolDefinition({
			name: RUN_TOOLS.needsMe,
			description:
				"The Gates that wait for a person, in every project, oldest first: the question, the options, and how long it waited. Use it to see what blocks a night, then answer a Gate with answer_gate when the person tells you what to choose.",
			inputSchema: {
				type: "object",
				properties: {
					project: {
						...projectProperty,
						description:
							"Only the Gates of this project: its id or name from list_projects. Leave it out for every project.",
					},
				},
			},
		}).server(async (args: unknown) => {
			const named = field(args, "project");
			const project =
				typeof named === "string" && named.trim() !== ""
					? await projectOf(args)
					: null;
			const gates = (await port.gates()).filter(
				(gate) =>
					!gate.answerPending &&
					(project === null || gate.projectId === project.id),
			);
			if (gates.length === 0) {
				return project
					? `No Gate of "${project.name}" waits for you.`
					: "No Gate waits for you.";
			}
			return JSON.stringify(
				gates.map((gate) => ({
					gate: gateIdOf(gate),
					project: gate.projectName,
					flow: gate.flowName,
					run: gate.runTitle,
					question: gate.question,
					options: gate.choices.map((choice) => ({
						option: choice.name,
						...(choice.description ? { description: choice.description } : {}),
						...(choice.needsNote ? { needsNote: true } : {}),
					})),
					waitingSince: iso(gate.openedAt),
					...(gate.deadline
						? {
								deadline: `Night Shift chooses "${gate.deadline.choose}" at ${iso(gate.deadline.at)} when nobody answers.`,
							}
						: {}),
					...(gate.canAnswer ? {} : { youCanAnswer: false }),
					open: port.runLink(gate.runId, gate.stepId),
				})),
				null,
				2,
			);
		}),
		toolDefinition({
			name: RUN_TOOLS.answerGate,
			description:
				"Answer a Gate that waits, with one of its options, and the run goes on. Answer only with the option the person chose, or one they told you to choose. An option with needsNote takes a note: the answer the next step goes on with.",
			inputSchema: {
				type: "object",
				properties: {
					gate: {
						type: "string",
						description: `The Gate's id, from ${RUN_TOOLS.needsMe}.`,
					},
					option: {
						type: "string",
						description: `The option's name, as ${RUN_TOOLS.needsMe} gives it.`,
					},
					note: {
						type: "string",
						description:
							"Words that go with the answer. Needed for an option with needsNote.",
					},
				},
				required: ["gate", "option"],
			},
		}).server(async (args: unknown) => {
			const id = parseGateId(field(args, "gate"));
			const option = field(args, "option");
			if (typeof option !== "string" || option.trim() === "") {
				throw new Error("Give the option's name in `option`.");
			}
			const note = field(args, "note");
			const words =
				typeof note === "string" && note.trim() !== "" ? note.trim() : null;
			const gate = (await port.gates()).find(
				(g) => g.runId === id.runId && g.stepId === id.stepId,
			);
			if (!gate || gate.answerPending) {
				throw new Error(
					`This Gate does not wait anymore. Call ${RUN_TOOLS.needsMe} for the Gates that wait.`,
				);
			}
			if (!gate.canAnswer) {
				throw new Error(
					"Your role in this Space does not let you answer Gates. Ask an owner or admin of the Space.",
				);
			}
			const wanted = option.trim();
			const choice =
				gate.choices.find((c) => c.name === wanted) ??
				gate.choices.find((c) => c.name.toLowerCase() === wanted.toLowerCase());
			if (!choice) {
				throw new Error(
					`"${wanted}" is not an option of this Gate. Choose one of: ${gate.choices.map((c) => `"${c.name}"`).join(", ")}.`,
				);
			}
			if (choice.needsNote && words === null) {
				throw new Error(
					`The option "${choice.name}" needs a note: the answer the next step goes on with. Give it in \`note\`.`,
				);
			}
			await port.answerGate({
				runId: gate.runId,
				stepId: gate.stepId,
				choice: choice.name,
				...(words !== null ? { note: words } : {}),
			});
			return `Answered "${choice.name}" to the Gate of "${gate.runTitle}". The run continues. Follow it at ${port.runLink(gate.runId, gate.stepId)}`;
		}),
		toolDefinition({
			name: RUN_TOOLS.getDigest,
			description:
				"What happened since a time: one line per run that ended (status, cost, pull request or why it ended) and the Gates that wait now. Without `since`: since your last morning digest. Use it to report on a night.",
			inputSchema: {
				type: "object",
				properties: {
					since: {
						...sinceProperty,
						description: `The runs that ended after this time. ${sinceProperty.description}`,
					},
				},
			},
		}).server(async (args: unknown) => {
			const since = sinceOf(field(args, "since"), now());
			const digest = await port.digest(since);
			const when =
				since === undefined ? "your last digest" : (iso(since) as string);
			if (!digest) return `No run ended since ${when}, and no Gate waits.`;
			const lines = [`Since ${iso(digest.from)}: ${digest.body}`];
			if (digest.runs.length > 0) {
				lines.push("", "Runs:");
				for (const run of digest.runs) {
					const parts = [
						run.statusText,
						...(run.detail ? [run.detail] : []),
						...(run.prUrl ? [`Pull request: ${run.prUrl}`] : []),
					];
					lines.push(`- ${run.title} (run ${run.runId}): ${parts.join(" · ")}`);
				}
			}
			if (digest.gates.length > 0) {
				lines.push(
					"",
					`Gates that wait (${RUN_TOOLS.needsMe} has their questions):`,
				);
				for (const gate of digest.gates) {
					lines.push(`- ${gate.title} (gate ${gateIdOf(gate)})`);
				}
			}
			return lines.join("\n");
		}),
	];
}
