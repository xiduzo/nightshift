import { z } from "zod";

const count = z.number();
const rate = z.number().nullable();
const step = z.enum([
	"install",
	"agent",
	"project",
	"checked",
	"flow",
	"schedule",
	"run",
	"finished",
	"pull_request",
	"merged",
]);

export const emptyInput = z.object({});

export const overviewSchema = z.object({
	activeInstallsThisWeek: count,
	nightsWithRunsThisWeek: count,
	openedPullRequests: count,
	mergedPullRequests: count,
	mergedRate: rate,
	costPerMergedPullRequest: rate,
	flaggedInstallIds: z.array(z.string()),
});

export const firstNightSchema = z.object({
	steps: z.array(
		z.object({
			step,
			installs: count,
			stopped: count,
			medianSecondsFromInstall: rate,
			medianSecondsFromPrevious: rate,
		}),
	),
	medianSecondsToFirstFinishedRun: rate,
	medianSecondsToFirstMergedPullRequest: rate,
});

export const nightsSchema = z.object({
	runsPerNight: z.array(z.object({ night: z.string(), runs: count })),
	endings: z.array(z.object({ endReason: z.string().nullable(), runs: count })),
	guards: z.array(z.object({ guard: z.string(), runs: count, share: rate })),
});

export const morningsSchema = z.object({
	opened: count,
	merged: count,
	closed: count,
	reverted: count,
	revertedWithin7Days: count,
	mergedRate: rate,
	revertedRate: rate,
	costPerMergedPullRequest: rate,
	byInstallWeek: z.array(
		z.object({
			installId: z.string(),
			week: z.string(),
			opened: count,
			merged: count,
			closed: count,
			reverted: count,
			flagged: z.boolean(),
		}),
	),
	gates: z.object({
		byPerson: count,
		byDeadline: count,
		medianWaitSeconds: rate,
		phone: count,
		desktop: count,
		web: count,
		lockScreen: count,
		other: count,
	}),
});

export const mixSchema = z.object({
	installs: count,
	agentsPerInstall: z.array(z.object({ agents: count, installs: count })),
	shareWithTwoOrMoreAgents: rate,
	os: z.array(z.object({ os: z.string(), installs: count })),
	arch: z.array(z.object({ arch: z.string(), installs: count })),
	entry: z.array(z.object({ entry: z.string(), installs: count })),
	host: z.array(z.object({ host: z.boolean(), installs: count })),
	versions: z.array(z.object({ version: z.string(), installs: count })),
	firstFlowStarters: z.array(
		z.object({
			starter: z.string().nullable(),
			from: z.string().nullable(),
			installs: count,
		}),
	),
});

export const retentionSchema = z.object({
	weeks: z.array(
		z.object({
			week: z.string(),
			activeInstalls: count,
			installsWithRuns: count,
			nights: count,
			nightsPerInstall: rate,
		}),
	),
	nightsPerWeek: rate,
	week4Retention: rate,
	cohorts: z.array(
		z.object({
			week: z.string(),
			size: count,
			retainedWeek4: rate,
		}),
	),
});
