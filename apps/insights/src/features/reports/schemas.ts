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
	"useful",
]);

export const emptyInput = z.object({});

export const overviewSchema = z.object({
	activeInstallsThisWeek: count,
	daysWithRunsThisWeek: count,
	finishedRuns: count,
	usefulRuns: count,
	usefulRate: rate,
	costPerUsefulResult: rate,
	neededYouRate: rate,
	flaggedInstallIds: z.array(z.string()),
});

export const funnelSchema = z.object({
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
	medianSecondsToFirstUsefulRun: rate,
});

export const daysSchema = z.object({
	runsPerDay: z.array(z.object({ day: z.string(), runs: count })),
	endings: z.array(z.object({ endReason: z.string().nullable(), runs: count })),
	guards: z.array(z.object({ guard: z.string(), runs: count, share: rate })),
});

export const feedbackSchema = z.object({
	finished: count,
	answered: count,
	useful: count,
	usefulRate: rate,
	costPerUsefulResult: rate,
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
	pullRequests: z.object({
		merged: count,
		closed: count,
		revertedWithin7Days: count,
		revertedRate: rate,
		byInstallWeek: z.array(
			z.object({
				installId: z.string(),
				week: z.string(),
				merged: count,
				closed: count,
				revertedWithin7Days: count,
				flagged: z.boolean(),
			}),
		),
	}),
});

const ladderTotals = z.object({
	landings: count,
	installs: count,
	costPerLanding: rate,
	rungs: z.array(
		z.object({
			rung: z.string(),
			landings: count,
			share: rate,
			installs: count,
			costPerLanding: rate,
		}),
	),
});

export const laddersSchema = z.object({
	work: ladderTotals,
	choice: ladderTotals.extend({
		decided: count,
		unsure: count,
		unsureShare: rate,
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
			days: count,
			daysPerInstall: rate,
		}),
	),
	daysPerWeek: rate,
	week4Retention: rate,
	cohorts: z.array(
		z.object({
			week: z.string(),
			size: count,
			retainedWeek4: rate,
		}),
	),
});
