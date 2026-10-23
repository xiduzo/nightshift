import type { Href } from "expo-router";

/**
 * Where a project page leads. The Inbox, Runs and Flows take the project
 * as the search param `projectId` and show only its Gates, runs or flows;
 * New run takes it as the project to start in.
 */
export const projectLinks = {
	page: (projectId: string): Href => ({
		pathname: "/projects/[projectId]",
		params: { projectId },
	}),
	inbox: (projectId: string): Href => ({
		pathname: "/inbox",
		params: { projectId },
	}),
	runs: (projectId: string): Href => ({
		pathname: "/runs",
		params: { projectId },
	}),
	flows: (projectId: string): Href => ({
		pathname: "/flows",
		params: { projectId },
	}),
	start: (projectId: string): Href => ({
		pathname: "/start",
		params: { projectId },
	}),
	gate: (gate: { runId: string; stepId: string }): Href => ({
		pathname: "/gates/[runId]/[stepId]",
		params: { runId: gate.runId, stepId: gate.stepId },
	}),
	run: (runId: string): Href => ({
		pathname: "/runs/[runId]",
		params: { runId },
	}),
};
