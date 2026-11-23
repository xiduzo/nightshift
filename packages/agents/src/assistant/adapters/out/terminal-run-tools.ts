/**
 * TanStack run tools for `nightshift mcp`, over a TerminalRunPort.
 */
import { now as timeNow } from "@nightshift/time";
import { toolDefinition } from "@tanstack/ai";
import type { BridgedTool } from "../../../port";
import { AUTHORING_TOOLS, field, runReport } from "../../domain/authoring";
import type { TerminalProject } from "../../terminal";
import {
	costText,
	gateIdOf,
	isoOrNull,
	parseGateId,
	projectProperty,
	RUN_STATUSES,
	RUN_TOOLS,
	reportSection,
	sinceOf,
	sinceProperty,
	statusesOf,
	type TerminalRunPort,
} from "../../terminal";

const RUNS_DEFAULT = 10;
const RUNS_MAX = 50;

export function terminalRunTools(
	port: TerminalRunPort,
	projectOf: (args: unknown) => Promise<TerminalProject>,
	now: () => number = timeNow,
): BridgedTool[] {
	return [
		toolDefinition({
			name: RUN_TOOLS.listRuns,
			description:
				"The newest runs of the project: id, flow, title, status, why it ended, when it started and ended, its cost and the pull request it opened. A test run has testRun: the nodes it pinned and skipped, which did not run. Filter by status and by start time. Use it to see what ran, and to find a run's id for get_run or stop_run.",
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
				runs.map(({ cost, test, ...run }) => ({
					...run,
					createdAt: isoOrNull(run.createdAt),
					endedAt: isoOrNull(run.endedAt),
					cost: costText(cost),
					// Only a test run says so: its pinned and skipped nodes did not run.
					...(test ? { testRun: test } : {}),
				})),
				null,
				2,
			);
		}),
		toolDefinition({
			name: AUTHORING_TOOLS.getRun,
			description:
				"One run of the project: its status, why it ended, whether it is a test run, its cost, the pull request it opened, its steps with their outcomes and notes, the end of the failed step's transcript, and its report. Use it to follow a run you started, to see why one failed, or to read what it produced.",
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
			// What the run produced comes last, after the steps.
			if (found.report) {
				const link = port.runLink(found.run.id, found.report.stepId);
				lines.push("", reportSection(found.report, link));
			}
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
				"The Gates that wait for a person, in every project, oldest first: how urgent each is (now, today or later), the situation, the background, the recommended option, the question, the options with what each does, and how long it waited. Use it to see what blocks the runs, then answer a Gate with answer_gate when the person tells you what to choose.",
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
					urgency: gate.urgency,
					...(gate.brief.situation ? { situation: gate.brief.situation } : {}),
					...(gate.brief.background.length > 0
						? {
								background: gate.brief.background.map((item) =>
									item.source
										? `${item.text} (source: ${item.source})`
										: item.text,
								),
							}
						: {}),
					...(gate.brief.recommendation?.option
						? {
								recommended: {
									option: gate.brief.recommendation.option,
									...(gate.brief.recommendation.reason
										? { reason: gate.brief.recommendation.reason }
										: {}),
								},
							}
						: {}),
					question: gate.question,
					options: gate.choices.map((choice) => ({
						option: choice.name,
						...(choice.description ? { description: choice.description } : {}),
						...(choice.impact ? { impact: choice.impact } : {}),
						...(choice.needsNote ? { needsNote: true } : {}),
					})),
					waitingSince: isoOrNull(gate.openedAt),
					...(gate.deadline
						? {
								deadline: `Night Shift chooses "${gate.deadline.choose}" at ${isoOrNull(gate.deadline.at)} when nobody answers.`,
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
	];
}
