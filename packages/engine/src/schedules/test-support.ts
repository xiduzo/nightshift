import { event, project, run } from "@nightshift/db/schema";
import { migratedDb } from "@nightshift/db/testing";
import { asc, inArray } from "drizzle-orm";
import { type EnginePayloads, type LoggedEvent, parseEventRow } from "../log";
import { appendEvent } from "../log/run-log/append";
import { localSpaceId } from "../testing/test-support";
import { drizzleScheduleLog } from "./adapters/out/drizzle-schedule-log";
import { inMemorySchedulePorts } from "./adapters/out/in-memory-neighbours";
import type { ScheduleFact } from "./domain/schedule-history";
import type { WebhookReceivedFact } from "./domain/webhook-delivery";

/** A run that started with a schedule as its trigger. */
type RunStartedFact = {
	projectId: string;
	scheduleId: string;
	at: number;
	runId: string;
};

/** A database in memory with the projects of the tests, and what a schedule log stands on. */
export async function scheduleGround() {
	const db = await migratedDb();
	const spaceId = await localSpaceId(db);
	await db.insert(project).values(
		["project-1", "project-2", "project-3"].map((id) => ({
			id,
			spaceId,
			name: id,
			folder: false,
		})),
	);
	const log = {
		append: (input: Parameters<typeof appendEvent>[1]) =>
			appendEvent(db, input, "here"),
	};
	/** The events of these types, in the order they were logged. */
	async function logged(
		...types: LoggedEvent["type"][]
	): Promise<LoggedEvent[]> {
		const rows = await db
			.select()
			.from(event)
			.where(inArray(event.type, types))
			.orderBy(asc(event.seq));
		return rows.map(parseEventRow);
	}
	return {
		deps: { db, log },
		logged,
		/** What the start of a scheduled run leaves: its row and its `RunStarted`. */
		async runStarted(fact: RunStartedFact) {
			const { projectId, scheduleId, at, runId } = fact;
			await db.insert(run).values({
				id: runId,
				spaceId,
				projectId,
				flow: "{}",
				title: "night",
				worktreePath: "",
				branch: `nightshift/${runId}`,
				baseRef: "main",
				walkerId: "here",
			});
			await log.append({
				runId,
				type: "RunStarted",
				payload: {
					projectId,
					flowName: "night",
					title: "night",
					start: "work",
					stopAt: null,
					inputs: {},
					trigger: { kind: "schedule", scheduleId, at },
				} satisfies EnginePayloads["RunStarted"],
			});
		},
	};
}

/** Every port of the schedules, with the clock at `at`: the log over a database in memory, the others in memory. Where each use-case test starts. */
export async function schedulePorts(at: number) {
	const { deps, logged, runStarted } = await scheduleGround();
	return {
		...inMemorySchedulePorts(at),
		log: drizzleScheduleLog(deps),
		/** A new log over the same facts: a daemon that starts again. */
		openLog: () => drizzleScheduleLog(deps),
		runStarted,
		/** The fired and skipped facts and the starts of scheduled runs, in the order they were logged. */
		async facts(): Promise<ScheduleFact[]> {
			const events = await logged(
				"RunStarted",
				"ScheduleFired",
				"ScheduleSkipped",
			);
			return events.flatMap((e): ScheduleFact[] => {
				if (e.type === "ScheduleFired") {
					const { projectId, scheduleId, at, runId, error } = e.payload;
					return [{ kind: "fired", projectId, scheduleId, at, runId, error }];
				}
				if (e.type === "ScheduleSkipped") {
					const { projectId, scheduleId, at, reason, runId } = e.payload;
					return [
						{
							kind: "skipped",
							projectId,
							scheduleId,
							at,
							reason,
							runId: runId ?? null,
						},
					];
				}
				if (e.type !== "RunStarted") return [];
				const { projectId, trigger } = e.payload;
				if (trigger?.kind !== "schedule" || !e.runId) return [];
				const { scheduleId, at } = trigger;
				return [
					{ kind: "run-started", projectId, scheduleId, at, runId: e.runId },
				];
			});
		},
		/** The webhooks whose secret checked out, in the order they arrived. */
		async webhooks(): Promise<WebhookReceivedFact[]> {
			return (await logged("WebhookReceived")).flatMap((e) =>
				e.type === "WebhookReceived"
					? [e.payload as unknown as WebhookReceivedFact]
					: [],
			);
		},
	};
}
