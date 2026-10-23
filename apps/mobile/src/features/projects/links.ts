import type { Href } from "expo-router";

/**
 * Where a project page leads. The Inbox and Runs take the project as the
 * search param `project`, Flows as `projectId`: each then shows only the
 * project's Gates, runs or flows. New run takes `projectId` as the
 * project to start in.
 */
export const projectLinks = {
	page: (projectId: string): Href => ({
		pathname: "/projects/[projectId]",
		params: { projectId },
	}),
	inbox: (projectId: string): Href => ({
		pathname: "/inbox",
		params: { project: projectId },
	}),
	runs: (projectId: string): Href => ({
		pathname: "/runs",
		params: { project: projectId },
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
