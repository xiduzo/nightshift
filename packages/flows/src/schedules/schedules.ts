import { Cron } from "croner";
import { z } from "zod";

import type { FlowInputDef } from "../flow";
import { deviceNameSchema, flowNameSchema, labelSchema } from "../nodes";
import { ruleProblem, templateRefs } from "../template";

/**
 * A project's schedules, which Night Shift keeps next to its flows. Each
 * schedule starts one flow when its cron line comes due, or when a webhook
 * arrives at its address (`webhook`). The daemon reads them again on every
 * tick and on every webhook, so an edit applies without a restart.
 *
 * ```json
 * {
 *   "version": 1,
 *   "schedules": [
 *     {
 *       "id": "night",
 *       "flow": "night",
 *       "inputs": { "epic": "42" },
 *       "cron": "0 22 * * 1-5",
 *       "stopAt": "07:00",
 *       "baseRef": "main",
 *       "enabled": true
 *     },
 *     {
 *       "id": "review-pr",
 *       "flow": "review",
 *       "inputs": { "pr": "{{event.body.pull_request.number}}" },
 *       "webhook": {
 *         "secret": "${GITHUB_HOOK_SECRET}",
 *         "when": "event.body.action = \"opened\""
 *       }
 *     }
 *   ]
 * }
 * ```
 *
 * The schema checks shape only. `validateSchedules` checks meaning (the flow
 * exists and runs, the cron line parses, the inputs fit the flow, a
 * schedule has a cron line or a webhook). Browser-safe.
 */

export const SCHEDULES_VERSION = 1;

/** A schedule id: a slug, unique in the file. */
export const scheduleIdSchema = z
	.string()
	.regex(
		/^[a-z0-9][a-z0-9-]{0,59}$/,
		"Use lowercase letters, digits and -, starting with a letter or digit.",
	);

/** A time of day on the schedule's clock, `HH:MM` (24 hours). */
export const timeOfDaySchema = z
	.string()
	.regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM, for example 07:00.");

/** Whether `timeZone` is an IANA time zone this runtime knows. */
export function isTimeZone(timeZone: string): boolean {
	try {
		new Intl.DateTimeFormat("en-US", { timeZone });
		return true;
	} catch {
		return false;
	}
}

/** A webhook's secret: one secret by name, as `${NAME}`. */
export const webhookSecretSchema = z
	.string()
	.trim()
	.regex(
		/^\$\{[A-Za-z_][A-Za-z0-9_]{0,127}\}$/,
		// biome-ignore lint/suspicious/noTemplateCurlyInString: secret references, as a person writes them.
		"Name a secret as ${NAME}, for example ${GITHUB_HOOK_SECRET}.",
	);

/**
 * A schedule that starts when a webhook arrives at its address
 * (`POST /hooks/<project id>/<schedule id>`). The sender proves it knows
 * `secret`: GitHub signs the body with it (`X-Hub-Signature-256`), any
 * other sender sends `Authorization: Bearer <secret>`. `when` is a JSONata
 * rule over `event` (`event.body`, `event.headers`): a webhook it does not
 * hold for is filtered out.
 */
export const scheduleWebhookSchema = z.object({
	secret: webhookSecretSchema,
	when: z.string().trim().min(1).optional(),
});
export type ScheduleWebhook = z.infer<typeof scheduleWebhookSchema>;

/**
 * The signal a webhook sends to the project's runs: each run whose Wait
 * waits for `name` wakes, with the event as the Wait's `data`. `key` is a
 * JSONata expression over `event`: then only a Wait whose own `key`
 * renders to the same text wakes. A Wait without a key takes any.
 */
export const scheduleSignalSchema = z.object({
	name: labelSchema,
	key: z.string().trim().min(1).optional(),
});
export type ScheduleSignal = z.infer<typeof scheduleSignalSchema>;

export const scheduleSchema = z.object({
	id: scheduleIdSchema,
	/**
	 * The flow file to start, by name. A webhook schedule that only sends
	 * a `signal` starts none.
	 */
	flow: flowNameSchema.optional(),
	/**
	 * Values for the flow's inputs, by name, as the start dialog sends them:
	 * a string for a `text` input, any JSON value (or JSON text) for `json`.
	 * Missing values take the input's default. A webhook schedule's values
	 * are templates over the event: `{{event.body.pull_request.number}}`.
	 */
	inputs: z.record(z.string(), z.json()).default({}),
	/**
	 * Five fields (minute hour day-of-month month day-of-week) in
	 * `timeZone`, for example `0 22 * * 1-5`. A schedule has either `cron`
	 * or `webhook`.
	 */
	cron: z.string().trim().min(1, "Enter a cron expression.").optional(),
	/** Starts the run when a webhook arrives, instead of at cron times. */
	webhook: scheduleWebhookSchema.optional(),
	/** With `webhook`: a signal it sends as well as, or instead of, a run. */
	signal: scheduleSignalSchema.optional(),
	/** The stop time: the first such time of day after the run starts. */
	stopAt: timeOfDaySchema.optional(),
	/**
	 * The clock of `cron` and `stopAt`: the time zone of the person who
	 * saved the schedule. Night Shift writes it on a save, so the Host
	 * fires it at the same hour whatever its own clock says. Unset: the
	 * clock of the computer that fires it.
	 */
	timeZone: z.string().trim().min(1).max(64).optional(),
	/** The git ref to branch the worktree from. Default: the clone's current HEAD. */
	baseRef: z.string().trim().min(1).optional(),
	/** A paused schedule stays in the file and starts nothing. */
	enabled: z.boolean().default(true),
	/**
	 * The Device its runs run on, by name. The Space's Host fires every
	 * schedule (or the one Device of a Space without a Host), so a schedule
	 * every Clone has never fires twice, and starts the run there. Unset:
	 * the run runs on the Device that fires it.
	 */
	device: deviceNameSchema.optional(),
	/**
	 * The Person whose runs it starts, when its `device` is another
	 * Person's: Night Shift writes it when you save the schedule, and the
	 * runs use that Device through its Offers only. Unset: the runs are
	 * the firing Device's owner's.
	 */
	person: z.string().trim().min(1).max(128).optional(),
});

export const schedulesFileSchema = z.object({
	version: z.literal(SCHEDULES_VERSION),
	schedules: z.array(scheduleSchema).default([]),
});

export type Schedule = z.infer<typeof scheduleSchema>;
/** What a schedule holds before defaults apply. */
export type ScheduleInput = z.input<typeof scheduleSchema>;
export type SchedulesFile = z.infer<typeof schedulesFileSchema>;

/** One problem in the schedules file. A schedule with an error does not start. */
export type ScheduleIssue = {
	severity: "error" | "warning";
	message: string;
	/** Absent for problems of the whole file. */
	scheduleId?: string;
};

/** What `validateSchedules` needs to know of one flow file. */
export type ScheduleFlowInfo = {
	inputs: readonly FlowInputDef[];
	/** Validation errors of the flow file: a flow with errors cannot run. */
	errorCount: number;
};

function cronOf(cron: string, timeZone?: string): Cron {
	// No callback: croner computes times and never starts a timer.
	return new Cron(cron.trim(), {
		mode: "5-part",
		...(timeZone ? { timezone: timeZone } : {}),
	});
}

/** Why a cron line does not parse, or null. */
export function cronError(cron: string): string | null {
	try {
		cronOf(cron);
		return null;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return message.replace(/^CronPattern: /, "");
	}
}

/**
 * The next `count` times of the cron line strictly after `after` (epoch ms),
 * on the clock of `timeZone` (default: this computer's). Empty when it does
 * not parse.
 */
export function nextCronTimes(
	cron: string,
	after: number,
	count = 1,
	timeZone?: string,
): number[] {
	try {
		return cronOf(cron, timeZone)
			.nextRuns(count, new Date(after))
			.map((date) => date.getTime());
	} catch {
		return [];
	}
}

/**
 * The latest time of the cron line at or before `at`, on the clock of
 * `timeZone` (default: this computer's). Null when there is none or it does
 * not parse.
 */
export function latestCronTime(
	cron: string,
	at: number,
	timeZone?: string,
): number | null {
	try {
		// Croner strips milliseconds and excludes the reference itself: one
		// second later makes `at` count when it is a time of the line.
		const [previous] = cronOf(cron, timeZone).previousRuns(
			1,
			new Date(at + 1000),
		);
		return previous && previous.getTime() <= at ? previous.getTime() : null;
	} catch {
		return null;
	}
}

/**
 * The first moment after `after` at which the clock of `timeZone` (default:
 * this computer's) shows `hhmm` ("07:00"): later today, else tomorrow.
 */
export function nextTimeOfDay(
	hhmm: string,
	after: number,
	timeZone?: string,
): number | null {
	if (!timeOfDaySchema.safeParse(hhmm).success) return null;
	const [hours, minutes] = hhmm.split(":").map(Number);
	return (
		nextCronTimes(`${minutes} ${hours} * * *`, after, 1, timeZone)[0] ?? null
	);
}

const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS = [1, 2, 3, 4, 5];
const WEEKEND = [0, 6];

/** A day-of-week field (`1-5`, `mon,wed`, `*`) as sorted day numbers (0 = Sunday), or null. */
function parseDays(field: string): number[] | null {
	if (field === "*") return [0, 1, 2, 3, 4, 5, 6];
	const day = (text: string): number | null => {
		const name = DAY_NAMES.indexOf(text.toLowerCase());
		if (name >= 0) return name;
		if (!/^\d$/.test(text)) return null;
		const n = Number(text);
		return n === 7 ? 0 : n <= 6 ? n : null;
	};
	const days = new Set<number>();
	for (const part of field.split(",")) {
		const range = part.split("-");
		if (range.length === 1) {
			const d = day(part);
			if (d === null) return null;
			days.add(d);
		} else if (range.length === 2) {
			const from = day(range[0] ?? "");
			// `5-7` ends on Sunday as 7.
			const toText = range[1] ?? "";
			const to = toText === "7" ? 7 : day(toText);
			if (from === null || to === null || to < from) return null;
			for (let d = from; d <= to; d++) days.add(d % 7);
		} else {
			return null;
		}
	}
	return [...days].sort((a, b) => a - b);
}

function sameDays(a: readonly number[], b: readonly number[]): boolean {
	return a.length === b.length && a.every((day, index) => day === b[index]);
}

/** A time and the days of the week: what the simple schedule picker edits. */
export type TimeAndDays = {
	/** `HH:MM`. */
	time: string;
	/** Day numbers, 0 = Sunday, sorted. All seven: every day. */
	days: number[];
};

/** The time and days of a cron line of the shape `M H * * days`, else null. */
export function cronToTimeAndDays(cron: string): TimeAndDays | null {
	const fields = cron.trim().split(/\s+/);
	if (fields.length !== 5) return null;
	const [minute, hour, dom, month, dow] = fields as [
		string,
		string,
		string,
		string,
		string,
	];
	if (!/^\d{1,2}$/.test(minute) || !/^\d{1,2}$/.test(hour)) return null;
	if (dom !== "*" || month !== "*") return null;
	const m = Number(minute);
	const h = Number(hour);
	if (m > 59 || h > 23) return null;
	const days = parseDays(dow);
	if (!days || days.length === 0) return null;
	return {
		time: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
		days,
	};
}

/** The cron line for a time and days of the week. Null when the time is not `HH:MM` or no day is chosen. */
export function timeAndDaysToCron({ time, days }: TimeAndDays): string | null {
	if (!timeOfDaySchema.safeParse(time).success) return null;
	const unique = [...new Set(days.map((d) => d % 7))].sort((a, b) => a - b);
	if (unique.length === 0) return null;
	const [hours, minutes] = time.split(":").map(Number);
	let dow: string;
	if (unique.length === 7) dow = "*";
	else if (sameDays(unique, WEEKDAYS)) dow = "1-5";
	else dow = unique.join(",");
	return `${minutes} ${hours} * * ${dow}`;
}

/**
 * A short description of a cron line for people: "every day at 22:00",
 * "weekdays at 22:00", "Mon, Wed at 06:30", "every 15 minutes". Shapes it
 * does not know come back as the cron line itself.
 */
export function describeCron(cron: string): string {
	const line = cron.trim().replace(/\s+/g, " ");
	const timeAndDays = cronToTimeAndDays(line);
	if (timeAndDays) {
		const { time, days } = timeAndDays;
		if (days.length === 7) return `every day at ${time}`;
		if (sameDays(days, WEEKDAYS)) return `weekdays at ${time}`;
		if (sameDays(days, WEEKEND)) return `weekends at ${time}`;
		// Monday first, the way a week reads.
		const ordered = [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
		return `${ordered.map((d) => DAY_LABELS[d]).join(", ")} at ${time}`;
	}
	const fields = line.split(" ");
	if (fields.length === 5 && fields.slice(1).every((f) => f === "*")) {
		const minute = fields[0] ?? "";
		if (minute === "*") return "every minute";
		const step = /^\*\/(\d{1,2})$/.exec(minute);
		if (step) return `every ${Number(step[1])} minutes`;
		if (/^\d{1,2}$/.test(minute) && Number(minute) <= 59) {
			return `every hour at :${minute.padStart(2, "0")}`;
		}
	}
	return line;
}

/** A value that takes the input's default: missing, null, or blank text. */
function isEmpty(value: unknown): boolean {
	return (
		value === undefined ||
		value === null ||
		(typeof value === "string" && value.trim() === "")
	);
}

/**
 * The problems of each schedule: a duplicate id, neither or both of a cron
 * line and a webhook, a flow that does not exist, does not load or has
 * errors, a cron line, a webhook rule or a signal key that does not parse,
 * and input values the flow does not take or lacks (a required input
 * without a value or a default), JSON text that does not parse, or a
 * webhook's template that reads something else than `event`. `flows` holds
 * the project's flow files by name, null when one does not parse.
 */
export function validateSchedules(
	schedules: readonly Schedule[],
	flows: Readonly<Record<string, ScheduleFlowInfo | null>>,
): ScheduleIssue[] {
	const issues: ScheduleIssue[] = [];
	const seen = new Set<string>();
	for (const schedule of schedules) {
		const error = (message: string) =>
			issues.push({ severity: "error", message, scheduleId: schedule.id });
		if (seen.has(schedule.id)) {
			error(`Another schedule has the id "${schedule.id}".`);
		}
		seen.add(schedule.id);

		const { cron, webhook, signal } = schedule;
		if (cron !== undefined && webhook !== undefined) {
			error(
				"A schedule runs at set times or when a webhook arrives, not both.",
			);
		} else if (cron === undefined && webhook === undefined) {
			error(
				"Choose when this schedule runs: at set times or when a webhook arrives.",
			);
		}
		if (cron !== undefined) {
			const cronProblem = cronError(cron);
			if (cronProblem)
				error(`The cron expression is not valid: ${cronProblem}`);
		}
		if (schedule.timeZone !== undefined && !isTimeZone(schedule.timeZone)) {
			error(
				`The time zone "${schedule.timeZone}" is not valid. Use a name such as Europe/Amsterdam.`,
			);
		}
		if (signal !== undefined && webhook === undefined) {
			error("Only a schedule that waits for a webhook can send a signal.");
		}
		const whenProblem = webhook?.when ? ruleProblem(webhook.when) : null;
		if (whenProblem) error(`The webhook's rule is not valid: ${whenProblem}`);
		const keyProblem = signal?.key ? ruleProblem(signal.key) : null;
		if (keyProblem) error(`The signal's key is not valid: ${keyProblem}`);

		if (schedule.flow === undefined) {
			// A webhook that only wakes Waits starts no flow.
			if (webhook === undefined || signal === undefined) {
				error("Choose a flow.");
			} else if (Object.keys(schedule.inputs).length > 0) {
				error("A schedule without a flow has no inputs.");
			}
			continue;
		}
		if (!Object.hasOwn(flows, schedule.flow)) {
			error(`The flow "${schedule.flow}" does not exist.`);
			continue;
		}
		const flow = flows[schedule.flow];
		if (!flow) {
			error(`The flow "${schedule.flow}" is not valid. Open it and fix it.`);
			continue;
		}
		if (flow.errorCount > 0) {
			error(
				`The flow "${schedule.flow}" has ${flow.errorCount === 1 ? "an error" : `${flow.errorCount} errors`}. Fix the flow so this schedule can run.`,
			);
		}
		const declared = new Map(flow.inputs.map((input) => [input.name, input]));
		for (const name of Object.keys(schedule.inputs)) {
			if (!declared.has(name)) {
				error(`The flow "${schedule.flow}" has no input "${name}".`);
			}
		}
		for (const input of flow.inputs) {
			const value = schedule.inputs[input.name];
			if (isEmpty(value)) {
				const hasDefault =
					input.default !== undefined && input.default.trim() !== "";
				if (input.required && !hasDefault) {
					error(`The input "${input.label ?? input.name}" needs a value.`);
				}
				continue;
			}
			// A webhook's value is a template over the event, read when it arrives.
			if (webhook !== undefined && typeof value === "string") {
				const refs = templateRefs(value);
				if (refs.some((ref) => ref.name !== "event")) {
					error(
						`The input "${input.name}" can read only the webhook, as {{event.body.number}} or {{event.headers.x-github-event}}.`,
					);
				}
				if (refs.length > 0) continue;
			}
			if ((input.type ?? "text") === "json" && typeof value === "string") {
				try {
					JSON.parse(value);
				} catch {
					error(`The value of input "${input.name}" is not valid JSON.`);
				}
			}
		}
	}
	return issues;
}
