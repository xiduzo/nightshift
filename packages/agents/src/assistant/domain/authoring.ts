/**
 * Data shapes for authoring tools: runs, profiles and flow rows in prompts.
 */
import type {
	Flow,
	FlowIssue,
	FlowPlace,
	ProjectFlowMap,
} from "@nightshift/flows";

export type AuthoringProfile = {
	device: string;
	profile: string;
	name: string;
	deviceName: string;
	kind: "agent" | "model";
	description?: string | null;
	harness?: string;
	model?: string;
	decider?: string;
};

export type AuthoringToolInfo = { name: string; description: string | null };

export type AuthoringCliTool = AuthoringToolInfo & {
	program: string | null;
	signsIn: boolean;
};

export type AuthoringSkill = {
	name: string;
	description: string | null;
	source: "project" | "computer";
};

export type AuthoringRunStep = {
	id: string;
	flow: string | null;
	nodeId: string;
	nodeType: string;
	visit: number;
	outcome: string | null;
	error: string | null;
	note: string | null;
	test?: "pinned" | "skipped";
};

export type AuthoringRun = {
	id: string;
	flow: string | null;
	title: string;
	status: string;
	result: string | null;
	reason: string | null;
	startedBy: string;
	startedAt: number;
	endedAt: number | null;
	flowDescription: string | null;
	steps: AuthoringRunStep[];
	transcriptHolds?: "so-far" | "cut";
};

export type AuthoringPort = {
	draft(): Promise<{ name: string; flow: Flow }>;
	flows(): Promise<ProjectFlowMap>;
	profiles(): Promise<AuthoringProfile[]>;
	tools(): Promise<{
		clis: AuthoringCliTool[];
		connections: AuthoringToolInfo[];
	}>;
	skills(): Promise<AuthoringSkill[]>;
	place(): Promise<FlowPlace>;
	run?: () => Promise<AuthoringRun | null>;
	propose(proposal: import("@nightshift/flows").FlowProposal): void | Promise<void>;
};

export const PROPOSAL_REFUSALS = 2;
export const RUN_REPORT_LIMIT = 12_000;

export function cut(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export function issueLines(issues: readonly FlowIssue[]): string {
	return issues.map((issue) => `- ${issue.message}`).join("\n");
}

export const errorsOf = (issues: readonly FlowIssue[]) =>
	issues.filter((issue) => issue.severity === "error");

export function field(args: unknown, key: string): unknown {
	if (typeof args !== "object" || args === null) return undefined;
	return (args as Record<string, unknown>)[key];
}

export function flowRows(flows: ProjectFlowMap, skip?: string) {
	return Object.entries(flows)
		.filter(([name]) => name !== skip)
		.map(([name, entry]) => ({
			name,
			title: entry.title,
			issues: entry.issues.length,
		}));
}

export function runReport(
	run: AuthoringRun,
	flowName: string | null,
	flowLabel: string,
): string {
	const lines = [
		`# ${flowLabel}`,
		"",
		`Run ${run.title} (${run.id.slice(0, 8)}…). Status: ${run.status}.`,
		...(run.reason ? [`Reason: ${run.reason}`] : []),
		"",
		"## Steps",
	];
	for (const step of run.steps) {
		lines.push(
			`- ${step.id} (${step.nodeType} ${step.nodeId}, visit ${step.visit})${step.outcome ? `: ${step.outcome}` : ""}${step.error ? ` — ${step.error}` : ""}`,
		);
	}
	return cut(lines.join("\n"), RUN_REPORT_LIMIT);
}