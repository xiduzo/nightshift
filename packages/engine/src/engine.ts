import { randomUUID } from "node:crypto";
import type {
	AgentEvent,
	AgentHarness,
	Effort,
	HarnessName,
	PermissionMode,
} from "@nightshift/agents/types";
import {
	agentSession,
	event,
	project,
	run,
} from "@nightshift/db/schema/nightshift";
import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";

import { createRunBus } from "./bus";
import { consumeStream } from "./consume";
import {
	appendEvent,
	deriveRunStatus,
	type EnginePayloads,
	type LoggedEvent,
	openSessions,
	parseEventRow,
	sessionEndings,
	sessionStartOrder,
	sumCostUsd,
} from "./events";
import {
	openTranscriptWriter,
	readRunTranscript,
	type TranscriptWriter,
	transcriptPath,
} from "./transcripts";
import type {
	Engine,
	EngineOptions,
	Project,
	RunDetail,
	RunStatus,
	RunStreamItem,
	RunSummary,
	SessionSummary,
	StartRunInput,
	TranscriptEntry,
} from "./types";
import { createWorktree, resolveRepoTopLevel } from "./worktrees";

const DEFAULT_MAX_CONCURRENT_SESSIONS = 2;
/** How long a stopped harness may take to end its stream. */
const STOP_GRACE_MS = 5_000;
const DEFAULT_RESUME_PROMPT = "Continue where you left off.";
const DEFAULT_HARNESS: HarnessName = "claude-code";
const SESSION_EVENT_TYPES = ["SessionStarted", "SessionEnded"];

/** The CLI a person runs to take over a harness session. */
const takeOverCli: Record<HarnessName, string> = {
	"claude-code": "claude",
};

type RunRow = typeof run.$inferSelect;
type SessionEnding = EnginePayloads["SessionEnded"];

type ActiveSession = {
	sessionId: string;
	controller: AbortController;
	done: Promise<void>;
};

/** A slot is reserved before any await, so two calls cannot both pass the cap. */
type Slot = ActiveSession | "starting";

export function createEngine(options: EngineOptions): Engine {
	const { db, harnesses, dataDir } = options;
	const maxConcurrentSessions =
		options.maxConcurrentSessions ?? DEFAULT_MAX_CONCURRENT_SESSIONS;
	if (!Number.isInteger(maxConcurrentSessions) || maxConcurrentSessions < 1) {
		throw new Error("maxConcurrentSessions must be a positive integer.");
	}

	const bus = createRunBus();
	/** Keyed by run id. A run has at most one session at a time. */
	const slots = new Map<string, Slot>();
	/** The last seq written per run. Loaded from disk on first use. */
	const lastSeqs = new Map<string, number>();

	const ready = recoverInterruptedSessions();
	// Every method awaits `ready` and sees the error there.
	ready.catch(() => {});

	/** A session that started but never ended belongs to a daemon that died. */
	async function recoverInterruptedSessions(): Promise<void> {
		const rows = await db
			.select()
			.from(event)
			.where(
				and(
					isNotNull(event.sessionId),
					inArray(event.type, SESSION_EVENT_TYPES),
				),
			)
			.orderBy(asc(event.seq));
		for (const open of openSessions(rows.map(parseEventRow))) {
			await appendEvent(db, {
				type: "SessionEnded",
				runId: open.runId,
				sessionId: open.sessionId,
				payload: {
					outcome: "interrupted",
					error: "The daemon stopped while this session ran.",
					errorKind: null,
					usage: null,
					costUsd: null,
					resetAt: null,
				},
			});
		}
	}

	function harnessFor(name: HarnessName): AgentHarness {
		const harness = harnesses[name];
		if (!harness) throw new Error(`No harness is configured for "${name}".`);
		return harness;
	}

	function reserveSlot(runId: string): void {
		if (slots.has(runId)) {
			throw new Error(
				"A session of this run is still running. Stop it or wait for it to end.",
			);
		}
		if (slots.size >= maxConcurrentSessions) {
			throw new Error(
				`The session cap is reached: ${slots.size} of ${maxConcurrentSessions} sessions run. Stop a run or wait for one to end.`,
			);
		}
		slots.set(runId, "starting");
	}

	function releaseStartingSlot(runId: string): void {
		if (slots.get(runId) === "starting") slots.delete(runId);
	}

	async function getRunRow(runId: string): Promise<RunRow> {
		const [row] = await db.select().from(run).where(eq(run.id, runId));
		if (!row) throw new Error(`Run not found: ${runId}`);
		return row;
	}

	async function getProjectRow(projectId: string) {
		const [row] = await db
			.select()
			.from(project)
			.where(eq(project.id, projectId));
		if (!row) throw new Error(`Project not found: ${projectId}`);
		return row;
	}

	/** The session events of the given runs, grouped by run, in log order. */
	async function loadSessionEvents(
		runIds: readonly string[],
	): Promise<Map<string, LoggedEvent[]>> {
		const grouped = new Map<string, LoggedEvent[]>();
		if (runIds.length === 0) return grouped;
		const rows = await db
			.select()
			.from(event)
			.where(
				and(
					inArray(event.runId, [...runIds]),
					inArray(event.type, SESSION_EVENT_TYPES),
				),
			)
			.orderBy(asc(event.seq));
		for (const row of rows) {
			const parsed = parseEventRow(row);
			if (!parsed.runId) continue;
			const list = grouped.get(parsed.runId) ?? [];
			list.push(parsed);
			grouped.set(parsed.runId, list);
		}
		return grouped;
	}

	async function runStatus(runId: string): Promise<RunStatus> {
		const events = await loadSessionEvents([runId]);
		return deriveRunStatus(events.get(runId) ?? []);
	}

	function toSummary(row: RunRow, events: readonly LoggedEvent[]): RunSummary {
		return {
			id: row.id,
			projectId: row.projectId,
			prompt: row.prompt,
			harness: row.harness as HarnessName,
			model: row.model,
			permissionMode: row.permissionMode as PermissionMode,
			effort: (row.effort as Effort | null) ?? null,
			worktreePath: row.worktreePath,
			branch: row.branch,
			baseRef: row.baseRef,
			status: deriveRunStatus(events),
			createdAt: row.createdAt.getTime(),
			costUsd: sumCostUsd(events),
		};
	}

	/** Session rows of a run, in the order their sessions started. */
	async function orderedSessions(
		runId: string,
		events: readonly LoggedEvent[],
	) {
		const rows = await db
			.select()
			.from(agentSession)
			.where(eq(agentSession.runId, runId))
			.orderBy(asc(agentSession.createdAt));
		const order = sessionStartOrder(events);
		const rank = (id: string) => {
			const index = order.indexOf(id);
			return index === -1 ? Number.MAX_SAFE_INTEGER : index;
		};
		return rows.sort((a, b) => rank(a.id) - rank(b.id));
	}

	async function lastSeqOf(runId: string): Promise<number> {
		const known = lastSeqs.get(runId);
		if (known !== undefined) return known;
		const rows = await db
			.select({ transcriptPath: agentSession.transcriptPath })
			.from(agentSession)
			.where(eq(agentSession.runId, runId));
		const entries = await readRunTranscript(rows.map((r) => r.transcriptPath));
		const last = entries.at(-1)?.seq ?? 0;
		// A session of this run may have written meanwhile; keep the larger.
		const current = Math.max(last, lastSeqs.get(runId) ?? 0);
		lastSeqs.set(runId, current);
		return current;
	}

	/**
	 * Starts one session in the background. The caller holds the run's slot
	 * in state "starting"; this replaces it with the active session.
	 */
	async function beginSession(input: {
		runRow: RunRow;
		harness: AgentHarness;
		prompt: string;
		resumeSessionId: string | null;
	}): Promise<void> {
		const { runRow, harness, prompt, resumeSessionId } = input;
		const runId = runRow.id;
		const sessionId = randomUUID();
		const path = transcriptPath(dataDir, runId, sessionId);

		await lastSeqOf(runId);
		await db
			.insert(agentSession)
			.values({ id: sessionId, runId, prompt, transcriptPath: path });
		const writer = openTranscriptWriter(path);
		try {
			await appendEvent(db, {
				type: "SessionStarted",
				runId,
				sessionId,
				payload: { prompt, resumeSessionId, transcriptPath: path },
			});
		} catch (error) {
			writer.close();
			throw error;
		}

		const active: ActiveSession = {
			sessionId,
			controller: new AbortController(),
			done: Promise.resolve(),
		};
		slots.set(runId, active);
		active.done = runSession({
			runRow,
			harness,
			prompt,
			resumeSessionId,
			active,
			writer,
		});
		bus.publish(runId, { kind: "status-changed" });
	}

	async function runSession(input: {
		runRow: RunRow;
		harness: AgentHarness;
		prompt: string;
		resumeSessionId: string | null;
		active: ActiveSession;
		writer: TranscriptWriter;
	}): Promise<void> {
		const { runRow, harness, prompt, resumeSessionId, active, writer } = input;
		const runId = runRow.id;
		const { sessionId, controller } = active;
		const signal = controller.signal;
		let ending: SessionEnding | null = null;

		const record = async (agentEvent: AgentEvent): Promise<void> => {
			const seq = (lastSeqs.get(runId) ?? 0) + 1;
			lastSeqs.set(runId, seq);
			const entry: TranscriptEntry = {
				seq,
				sessionId,
				at: Date.now(),
				event: agentEvent,
			};
			// On disk first, then on the bus: watchRun depends on this order.
			writer.append(entry);
			bus.publish(runId, { kind: "transcript", entry });

			if (agentEvent.type === "session") {
				await db
					.update(agentSession)
					.set({ harnessSessionId: agentEvent.sessionId })
					.where(eq(agentSession.id, sessionId));
				await appendEvent(db, {
					type: "HarnessSessionAssigned",
					runId,
					sessionId,
					payload: {
						harnessSessionId: agentEvent.sessionId,
						model: agentEvent.model ?? null,
					},
				});
			} else if (agentEvent.type === "finished") {
				ending = {
					outcome: "finished",
					error: null,
					errorKind: null,
					usage: agentEvent.usage ?? null,
					costUsd: agentEvent.usage?.costUsd ?? null,
					resetAt: null,
				};
			} else if (agentEvent.type === "error") {
				const stopped = agentEvent.kind === "aborted" || signal.aborted;
				ending = {
					outcome: stopped ? "stopped" : "failed",
					error: agentEvent.message,
					errorKind: agentEvent.kind,
					usage: null,
					costUsd: null,
					resetAt: agentEvent.resetAt ?? null,
				};
			}
		};

		const endWithoutResult = (message: string): SessionEnding => ({
			outcome: signal.aborted ? "stopped" : "failed",
			error: signal.aborted ? "The session was stopped." : message,
			errorKind: signal.aborted ? "aborted" : "harness",
			usage: null,
			costUsd: null,
			resetAt: null,
		});

		try {
			const stream = harness.run({
				cwd: runRow.worktreePath,
				prompt,
				model: runRow.model,
				permissionMode: runRow.permissionMode as PermissionMode,
				effort: (runRow.effort as Effort | null) ?? undefined,
				resumeSessionId: resumeSessionId ?? undefined,
				signal,
			});
			await consumeStream(stream, {
				signal,
				graceMs: STOP_GRACE_MS,
				onItem: record,
				isLast: (e) => e.type === "finished" || e.type === "error",
			});
		} catch (error) {
			ending ??= endWithoutResult(
				error instanceof Error ? error.message : String(error),
			);
		} finally {
			writer.close();
			const final =
				ending ??
				endWithoutResult("The harness stream ended without a result.");
			try {
				await appendEvent(db, {
					type: "SessionEnded",
					runId,
					sessionId,
					payload: final,
				});
			} catch (error) {
				// The next start marks this session interrupted.
				console.error(
					`[engine] could not record the end of session ${sessionId}`,
					error,
				);
			}
			if (slots.get(runId) === active) slots.delete(runId);
			bus.publish(runId, { kind: "status-changed" });
		}
	}

	function shellQuote(value: string): string {
		if (/^[\w@%+=:,./-]+$/.test(value)) return value;
		return `'${value.replaceAll("'", `'\\''`)}'`;
	}

	function toProject(row: typeof project.$inferSelect): Project {
		return {
			id: row.id,
			name: row.name,
			repoPath: row.repoPath,
			createdAt: row.createdAt.getTime(),
		};
	}

	const engine: Engine = {
		async listProjects() {
			await ready;
			const rows = await db
				.select()
				.from(project)
				.orderBy(asc(project.createdAt));
			return rows.map(toProject);
		},

		async addProject(input) {
			await ready;
			const repoPath = await resolveRepoTopLevel(input.repoPath);
			const [existing] = await db
				.select()
				.from(project)
				.where(eq(project.repoPath, repoPath));
			if (existing) return toProject(existing);

			const id = randomUUID();
			const name = input.name ?? repoPath.split("/").at(-1) ?? repoPath;
			const [row] = await db
				.insert(project)
				.values({ id, name, repoPath })
				.returning();
			if (!row) throw new Error("Could not add the project.");
			await appendEvent(db, {
				type: "ProjectAdded",
				payload: { projectId: id, name, repoPath },
			});
			return toProject(row);
		},

		async removeProject(projectId) {
			await ready;
			await getProjectRow(projectId);
			const runs = await db
				.select({ id: run.id })
				.from(run)
				.where(eq(run.projectId, projectId));
			if (runs.some((r) => slots.has(r.id))) {
				throw new Error(
					"A run of this project is still running. Stop it first.",
				);
			}
			// Worktrees stay on disk: a person may still have work in them.
			await db.delete(project).where(eq(project.id, projectId));
			await appendEvent(db, {
				type: "ProjectRemoved",
				payload: { projectId },
			});
		},

		async listRuns(input) {
			await ready;
			const query = db.select().from(run);
			const rows = await (input?.projectId
				? query.where(eq(run.projectId, input.projectId))
				: query
			).orderBy(desc(run.createdAt));
			const events = await loadSessionEvents(rows.map((r) => r.id));
			return rows.map((row) => toSummary(row, events.get(row.id) ?? []));
		},

		async getRun(runId) {
			await ready;
			const row = await getRunRow(runId);
			const events = (await loadSessionEvents([runId])).get(runId) ?? [];
			const sessionRows = await orderedSessions(runId, events);
			const endings = sessionEndings(events);
			const sessions: SessionSummary[] = sessionRows.map((s) => {
				const ending = endings.get(s.id);
				return {
					id: s.id,
					harnessSessionId: s.harnessSessionId,
					prompt: s.prompt,
					createdAt: s.createdAt.getTime(),
					outcome: ending?.outcome ?? null,
					error: ending?.error ?? null,
					costUsd: ending?.costUsd ?? null,
				};
			});
			const lastHarnessSessionId = sessionRows.findLast(
				(s) => s.harnessSessionId,
			)?.harnessSessionId;
			const cli = takeOverCli[row.harness as HarnessName] ?? "claude";
			const detail: RunDetail = {
				...toSummary(row, events),
				sessions,
				takeOverCommand: lastHarnessSessionId
					? `cd ${shellQuote(row.worktreePath)} && ${cli} --resume ${shellQuote(lastHarnessSessionId)}`
					: null,
			};
			return detail;
		},

		async startRun(input: StartRunInput) {
			await ready;
			const harness = harnessFor(DEFAULT_HARNESS);
			const projectRow = await getProjectRow(input.projectId);

			const runId = randomUUID();
			reserveSlot(runId);
			try {
				const worktree = await createWorktree({
					repoPath: projectRow.repoPath,
					shortId: runId.slice(0, 8),
					baseRef: input.baseRef,
				});
				const [runRow] = await db
					.insert(run)
					.values({
						id: runId,
						projectId: projectRow.id,
						prompt: input.prompt,
						harness: harness.name,
						model: input.model,
						permissionMode: input.permissionMode,
						effort: input.effort ?? null,
						worktreePath: worktree.worktreePath,
						branch: worktree.branch,
						baseRef: worktree.baseRef,
					})
					.returning();
				if (!runRow) throw new Error("Could not create the run.");
				await appendEvent(db, {
					type: "RunStarted",
					runId,
					payload: {
						projectId: projectRow.id,
						prompt: input.prompt,
						harness: harness.name,
						model: input.model,
						permissionMode: input.permissionMode,
						effort: input.effort ?? null,
					},
				});
				await appendEvent(db, {
					type: "WorktreeCreated",
					runId,
					payload: worktree,
				});
				await beginSession({
					runRow,
					harness,
					prompt: input.prompt,
					resumeSessionId: null,
				});
				const events = (await loadSessionEvents([runId])).get(runId) ?? [];
				return toSummary(runRow, events);
			} finally {
				releaseStartingSlot(runId);
			}
		},

		async stopRun(runId) {
			await ready;
			await getRunRow(runId);
			const slot = slots.get(runId);
			if (!slot || slot === "starting") return;
			if (!slot.controller.signal.aborted) {
				await appendEvent(db, {
					type: "StopRequested",
					runId,
					sessionId: slot.sessionId,
					payload: {},
				});
				slot.controller.abort();
			}
			await slot.done;
		},

		async resumeRun(runId, prompt) {
			await ready;
			const runRow = await getRunRow(runId);
			const harness = harnessFor(runRow.harness as HarnessName);
			const events = (await loadSessionEvents([runId])).get(runId) ?? [];
			const sessionRows = await orderedSessions(runId, events);
			const resumeSessionId = sessionRows.findLast(
				(s) => s.harnessSessionId,
			)?.harnessSessionId;
			if (!resumeSessionId) {
				throw new Error(
					"This run has no harness session to resume. Start a new run.",
				);
			}

			reserveSlot(runId);
			try {
				await beginSession({
					runRow,
					harness,
					prompt: prompt ?? DEFAULT_RESUME_PROMPT,
					resumeSessionId,
				});
			} finally {
				releaseStartingSlot(runId);
			}
		},

		watchRun(runId, { signal, afterSeq }) {
			return watch(runId, signal, afterSeq ?? 0);
		},
	};

	async function* watch(
		runId: string,
		signal: AbortSignal,
		afterSeq: number,
	): AsyncGenerator<RunStreamItem> {
		await ready;
		await getRunRow(runId);
		if (signal.aborted) return;

		const queue: (
			| { kind: "transcript"; entry: TranscriptEntry }
			| { kind: "status-changed" }
		)[] = [];
		let wake: (() => void) | null = null;
		const notify = () => {
			const resolve = wake;
			wake = null;
			resolve?.();
		};
		// Subscribe before reading disk: an entry is on disk before it is
		// published, so every entry is either on disk or in the queue.
		const unsubscribe = bus.subscribe(runId, (item) => {
			queue.push(item);
			notify();
		});
		signal.addEventListener("abort", notify, { once: true });

		try {
			let lastSeq = afterSeq;
			let lastStatus = await runStatus(runId);
			yield { kind: "status", status: lastStatus };

			const sessions = await db
				.select({ transcriptPath: agentSession.transcriptPath })
				.from(agentSession)
				.where(eq(agentSession.runId, runId));
			const replay = await readRunTranscript(
				sessions.map((s) => s.transcriptPath),
			);
			for (const entry of replay) {
				if (signal.aborted) return;
				if (entry.seq <= lastSeq) continue;
				lastSeq = entry.seq;
				yield { kind: "transcript", entry };
			}

			while (!signal.aborted) {
				const item = queue.shift();
				if (!item) {
					await new Promise<void>((resolve) => {
						wake = resolve;
					});
					continue;
				}
				if (item.kind === "transcript") {
					if (item.entry.seq <= lastSeq) continue;
					lastSeq = item.entry.seq;
					yield item;
				} else {
					const status = await runStatus(runId);
					if (status !== lastStatus) {
						lastStatus = status;
						yield { kind: "status", status };
					}
				}
			}
		} finally {
			unsubscribe();
			signal.removeEventListener("abort", notify);
		}
	}

	return engine;
}
