import type {
	Flow,
	FlowIssue,
	FlowPlace,
	JsonValue,
	ProjectFlowMap,
} from "@nightshift/flows";
import type { TerminalProject } from "./terminal-project";
import type { TerminalRunPort } from "./terminal-runs";

/** Knowledge reads the terminal tools need (mirrors KnowledgePort, kept local for H1). */

type AuthoringCliTool = {
	name: string;
	description: string | null;
	program: string | null;
	signsIn: boolean;
};
type AuthoringProfile = {
	device: string;
	profile: string;
	name: string;
	deviceName: string;
	kind: "agent" | "model";
};
type AuthoringSkill = {
	name: string;
	description: string | null;
	source: "project" | "computer";
};
type AuthoringToolInfo = { name: string; description: string | null };

export type TerminalKnowledgePort = {
	searchKnowledge(
		projectId: string,
		query: string,
		limit: number,
	): Promise<unknown[]>;
	readKnowledge(
		projectId: string,
		path: string,
		maxBytes: number,
		from?: { section?: string; line?: number; page?: number },
	): Promise<unknown | null>;
};

/** What the terminal tools read and write: Night Shift on this computer. */
export type TerminalPort = TerminalRunPort &
	TerminalKnowledgePort & {
		/** The files of the project's knowledge, as its Space lists them: its MCP resources. */
		knowledgeFiles(
			projectId: string,
		): Promise<{ path: string; size: number }[]>;
		projects(): Promise<TerminalProject[]>;
		flows(projectId: string): Promise<ProjectFlowMap>;
		/** The profiles a node of the project may name, each on its Device. */
		profiles(projectId: string): Promise<AuthoringProfile[]>;
		tools(): Promise<{
			clis: AuthoringCliTool[];
			connections: AuthoringToolInfo[];
		}>;
		skills(projectId: string): Promise<AuthoringSkill[]>;
		/** The place the project's flow `name` is checked in, as the editor checks it. */
		place(projectId: string, name?: string): Promise<FlowPlace>;
		/** Saves the flow as a new revision. Returns its issues as saved. */
		saveFlow(projectId: string, name: string, flow: Flow): Promise<FlowIssue[]>;
		startRun(
			projectId: string,
			flowName: string,
			inputs: Record<string, JsonValue>,
		): Promise<{ id: string; status: string }>;
		/** Where a person opens the flow in Night Shift. */
		flowLink(projectId: string, name: string): string;
	};
