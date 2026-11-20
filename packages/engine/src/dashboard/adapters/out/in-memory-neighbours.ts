import type { AnswerCost } from "../../../assistant";
import type { Actor } from "../../../contract";
import type { FlowRevisionItem } from "../../../flows";
import type { RunDetail, RunSummary } from "../../../read";
import type {
	AnswerCosts,
	DashboardFlows,
	DashboardProjects,
	DashboardRuns,
} from "../../application/ports";

/** What a twin was asked, in order: the port, the actor and the request. */
export type Asked = { port: string; actor: Actor; request: unknown };

/**
 * The twins of the dashboard's ports, filled per Space. Each records what
 * it was asked. `refuse` makes every call of a port throw that error, as a
 * Space view does for an actor who may not read.
 */
export function inMemoryDashboardPorts() {
	const asked: Asked[] = [];
	const runs = new Map<string, RunSummary[]>();
	const details = new Map<string, RunDetail>();
	const flows = new Map<string, string[]>();
	const revisions = new Map<string, FlowRevisionItem[]>();
	const projects = new Map<string, { id: string; name: string }[]>();
	const costs = new Map<string, AnswerCost[]>();
	const refusals = new Map<string, Error>();

	function ask(port: string, actor: Actor, request: unknown): void {
		asked.push({ port, actor, request });
		const refusal = refusals.get(port);
		if (refusal) throw refusal;
	}

	const dashboardRuns: DashboardRuns = {
		async list(actor, request) {
			ask("runs.list", actor, request);
			const all = runs.get(request.spaceId) ?? [];
			return request.projectId === undefined
				? all
				: all.filter((run) => run.projectId === request.projectId);
		},
		async get(actor, request) {
			ask("runs.get", actor, request);
			const detail = details.get(request.runId);
			if (!detail) throw new Error("No such run.");
			return detail;
		},
	};
	const dashboardFlows: DashboardFlows = {
		async list(actor, request) {
			ask("flows.list", actor, request);
			return (flows.get(request.projectId) ?? []).map((name) => ({ name }));
		},
		async revisions(actor, request) {
			ask("flows.revisions", actor, request);
			return revisions.get(`${request.projectId}/${request.name}`) ?? [];
		},
	};
	const dashboardProjects: DashboardProjects = {
		async list(actor, request) {
			ask("projects.list", actor, request);
			return projects.get(request.spaceId) ?? [];
		},
	};
	const answerCosts: AnswerCosts = {
		async list(actor, request) {
			ask("answerCosts.list", actor, request);
			return (costs.get(request.spaceId) ?? []).filter(
				(cost) => request.since === undefined || cost.at >= request.since,
			);
		},
	};

	return {
		runs: dashboardRuns,
		flows: dashboardFlows,
		projects: dashboardProjects,
		answerCosts,
		asked,
		/** The runs of a Space. A run with steps is also a detail `get` gives. */
		setRuns(spaceId: string, list: readonly (RunSummary | RunDetail)[]) {
			runs.set(spaceId, [...list]);
			for (const run of list) {
				if ("steps" in run) details.set(run.id, run);
			}
		},
		setFlows(projectId: string, names: readonly string[]) {
			flows.set(projectId, [...names]);
		},
		setRevisions(
			projectId: string,
			name: string,
			list: readonly FlowRevisionItem[],
		) {
			revisions.set(`${projectId}/${name}`, [...list]);
		},
		setProjects(
			spaceId: string,
			list: readonly { id: string; name: string }[],
		) {
			projects.set(spaceId, [...list]);
		},
		setAnswerCosts(spaceId: string, list: readonly AnswerCost[]) {
			costs.set(spaceId, [...list]);
		},
		/** Every call of `port` (`runs.list`, `flows.revisions`, ...) throws `error`. */
		refuse(port: string, error: Error) {
			refusals.set(port, error);
		},
	};
}

let made = 0;

/** A finished run of `night` in project p1 on this computer, with `fields` over it. */
export function runSummaryOf(fields: Partial<RunSummary> = {}): RunSummary {
	made += 1;
	const walker = { id: "device-1", name: "this computer", thisDevice: true };
	return {
		id: `run-${made}`,
		projectId: "p1",
		walker,
		device: walker,
		trigger: { kind: "manual" },
		startedBy: null,
		flowName: "night",
		title: `Run ${made}`,
		worktreePath: "",
		branch: `nightshift/run-${made}`,
		baseRef: "main",
		status: "finished",
		reason: null,
		result: null,
		wakeAt: null,
		signal: null,
		inputs: {},
		stopAt: null,
		stopAfterStep: false,
		createdAt: 0,
		endedAt: null,
		costUsd: 0,
		costEstimated: false,
		costMissing: 0,
		costCalls: 1,
		warnings: [],
		subflows: [],
		gates: [],
		sleeps: [],
		...fields,
	};
}
