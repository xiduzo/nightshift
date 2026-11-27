import type { AgentHarnessName } from "@nightshift/agents/types";
import type { Outcome } from "@nightshift/flows";
import { iso } from "@nightshift/time";
import type { RunResult, RunStatus } from "../../../run-status";
import type {
	InputValues,
	RunEndReason,
	Scope,
	StepOutcome,
	StepOutputs,
} from "../step";

/**
 * The events of a run, and the words their payloads use: its start, where
 * its work is and moves, a resume, a stop, its end, a warning, and the
 * feedback on what it did.
 */

/** How a run ended. `running` is never logged: it is the absence of an end. */
export type RunEnding = Exclude<RunStatus, "running">;

/**
 * The output a pinned node of a test run gives (ADR 27): the end of the
 * step of an earlier run it comes from. A pin of a pinned step names the
 * step the output first came from.
 */
export type PinnedOutput = {
	runId: string;
	stepId: string;
	/** When that step ended. */
	endedAt: number;
	outcome: StepOutcome;
	outputs: StepOutputs;
};

/**
 * A test run's pins and skips, as its `RunStarted` records them (ADR 27):
 * a node named here stands in at the top level of the run, and runs nothing.
 */
export type TestRun = {
	/** The pinned nodes, by id: each gives this output. */
	pinned: Record<string, PinnedOutput>;
	/** The skipped nodes, by id: each gives this outcome and empty output fields. */
	skipped: Record<string, Outcome>;
};

/** Who resumed a run: a person, or the daemon after a restart. */
export type ResumedBy = "person" | "daemon";
/** Who stopped a run: a person, or the daemon (the Offer a step ran under ended). */
export type StoppedBy = "person" | "daemon";
/** What a `RunResumed` did beyond a resume (`RunResumed.action`). */
export type ResumeAction = "restart" | "rerun";

export type RunPayloads = {
	RunStarted: {
		projectId: string;
		flowName: string | null;
		/** The Flow revision the run starts from (ADR 2). Absent: none (a quick run, a flow file), or before revisions. */
		flowRevision?: string;
		title: string;
		/** The node the walk starts at. */
		start: string;
		/** Epoch ms: no new step or item starts after it. Absent before Slice 4. */
		stopAt?: number | null;
		/** The values of the flow's inputs, defaults applied. Absent before flow format 2. */
		inputs?: InputValues;
		/** Flow format 1: the run parameters. Read as `inputs`. */
		params?: Record<string, string>;
		/** What started the run. Absent before Slice 7: a person. */
		trigger?: RunTrigger;
		/**
		 * The Person who started the run (their id). Null for a schedule.
		 * Absent before Members.
		 */
		startedBy?: string | null;
		/**
		 * The run's project has no folder (ADR 22): the run works in a run
		 * folder of its own on each Device of its steps, with no branch and
		 * no base. Absent: it works in its own copy of the project.
		 */
		runFolder?: true;
		/**
		 * A test run (ADR 27): the nodes that stand in for themselves, with
		 * the output each pin gives. The run keeps nothing that lasts.
		 * Absent: every node runs.
		 */
		test?: TestRun;
	};
	WorktreeCreated: { worktreePath: string; branch: string; baseRef: string };
	/**
	 * The run's work moved to another Device before a step there: the
	 * Device that had it pushed the branch (it had nothing uncommitted), and
	 * the next one fetched it into its own worktree of the run.
	 * `worktreePath` is that worktree, on `to`.
	 */
	/** The step's Device was offline: the step runs on another Device of its plan (ADR 17). */
	StepMoved: {
		from: string;
		to: string;
	};
	HandedOff: {
		from: string;
		to: string;
		commit: string;
		branch: string;
		worktreePath: string;
	};
	/**
	 * Another Device walks the run from here on: the one that walked it
	 * wrote this last; the new Walker resumes from the archived checkpoint.
	 */
	WalkerMoved: { from: string; to: string; by: string | null };
	/**
	 * The new Walker has the run's Walk state from the archive, and walks
	 * it from here: its first event after `WalkerMoved`. Until the new
	 * Walker wrote to the run, the run still arrives, and it tries again
	 * (`runsArriving`).
	 */
	WalkerArrived: { from: string };
	/**
	 * A person continued a stopped, failed or interrupted run, or the daemon
	 * continued a run it had stopped mid-step, after a restart.
	 */
	RunResumed: {
		/** The node the walk continues at. */
		nodeId: string;
		/** Set when the walk continues an existing Agent step's session. */
		stepId: string | null;
		prompt: string | null;
		/** The scope of `nodeId`: the called flow (and element) the walk continues in. */
		scope?: Scope | null;
		/** The stop time had passed: a person resumed past it, so it no longer applies. */
		clearStopAt?: boolean;
		/** Absent before automatic resume: a person. */
		by?: ResumedBy;
		/** Why the daemon resumed the run. */
		reason?: string;
		/**
		 * What the person asked for, when it was more than a resume.
		 * `restart`: the running step was stopped and continued at once
		 * (`restartStep`). `rerun`: the run walks again from `nodeId`, a
		 * top-level node, with a new visit of it (`rerunFrom`); `stepId` is
		 * then the Agent step whose harness session that visit continues
		 * with `prompt`, or null for a fresh session. Absent: a resume.
		 */
		action?: ResumeAction;
	};
	/**
	 * The run stops now. `by`: a person, or Night Shift itself (the Offer
	 * the step ran under ended). Absent in older logs: a person.
	 * `restart`: the stop of a restart (`RunResumed` with the action
	 * `restart` follows). Absent in older logs: that `RunResumed` tells.
	 */
	StopRequested: { by?: StoppedBy; restart?: true };
	/**
	 * A person took the run over by hand: they copied or shared the
	 * command that opens its last harness session (`by`, null when nobody
	 * signed in did). On the step of that session. A fact of what a person
	 * did, not of the walk: the run goes on as it was.
	 */
	RunTakenOver: { by: string | null; harness: AgentHarnessName };
	/** A person asked to stop the run before its next step or item. */
	StopAfterStepRequested: Record<string, never>;
	/** A person withdrew the stop after the step: the run goes on. */
	StopAfterStepCancelled: Record<string, never>;
	/**
	 * `result`: the status of the End node that ended the run, as its flow
	 * chose (the reason is then the End's message). Absent for every other
	 * end, and in older logs.
	 */
	RunEnded: {
		status: RunEnding;
		/** The sentence a person reads. Null when the run finished with nothing to say. */
		reason: string | null;
		/**
		 * Why it ended, as a code. Absent in logs written before the code
		 * was stored: a reader proves one from the sentence, or `_OTHER`.
		 */
		endReason?: RunEndReason;
		/**
		 * The node whose step ended the run as failed: the node the reason
		 * names. Absent when no step's failure ended the run (it finished,
		 * a person or the stop time stopped it, the step cap, the engine
		 * failed), and in logs written before it was stored: not known.
		 */
		node?: string;
		result?: RunResult;
	};
	/**
	 * Something went wrong that did not fail the step, and that a person
	 * should know: for example, what a step cost is not known. Logged with
	 * the step it is about, when there is one.
	 */
	RunWarned: { kind: RunWarningKind; message: string };
	/**
	 * A run opened a pull request. On the run, not on a step. The latest
	 * one is the pull request the morning check asks about.
	 */
	PullRequestOpened: { url: string };
	/**
	 * Feedback on what a run did: a Gate was answered, on the Gate's step,
	 * whether a person found the run useful, what became of the run's pull
	 * request, or a name a Command step wrote in its data
	 * (`scores`), on that step. What each name, value and `by` means is in
	 * `scores.ts`. The metrics and the export count them.
	 */
	Scored: {
		/** One of Night Shift's own names (`ScoreName`), or a name a flow chose. */
		score: string;
		value: number;
		label: string | null;
		by?: "person" | "deadline";
		/** Where a Gate answer came from. Absent on every other score. */
		via?: GateVia;
	};
};

/**
 * What a run warning is about. `cost-unknown`: a step ended without a cost.
 * The guards of the run policy: `budget` (the run passed its budget),
 * `turns` (a session reached its turn limit), `stalled` (an Agent step
 * showed no activity for its idle limit), `looping` (an agent made the
 * same tool call with the same input three times in a row). `base-ref`:
 * the run does not start from the newest commit of its base branch (the
 * fetch failed, or the branch went apart from the remote's). `score`: a
 * Command, Agent or Value step wrote a score Night Shift left out
 * (`scores.ts`). `shape`: a step's data does not match the output schema
 * Night Shift inferred from an earlier run (`outputVerdict`): no person
 * confirmed it, so the step goes on. `report`: an End step's report was
 * longer than the cap, so Night Shift kept only its start (ADR 26). A
 * reader treats the kinds as an open list: a later build may add one.
 */
export type RunWarningKind =
	| "cost-unknown"
	| "budget"
	| "turns"
	| "stalled"
	| "looping"
	| "base-ref"
	| "score"
	| "device-fallback"
	| "shape"
	| "report";

/**
 * The names Night Shift scores itself (`scores.ts` says what each means).
 * A flow may not write them. A reader treats the names of a `Scored` event
 * as an open list: a flow names its own, and a later build may add one.
 */
export type ScoreName =
	| "gate_decision"
	| "useful"
	| "pr_merged"
	| "pr_closed"
	| "reverted_within_7d";

/** Where a Gate answer came from. `_OTHER` when the caller did not say. */
export type GateVia = "web" | "phone" | "lock_screen" | "_OTHER";

/** What started a run: a person, or a schedule of its project at a cron time or on a webhook. */
export type RunTrigger =
	| { kind: "manual" }
	/** `at`: the cron time the run started for (epoch ms). */
	| { kind: "schedule"; scheduleId: string; at: number }
	/** `at`: when the webhook arrived (epoch ms). */
	| { kind: "webhook"; scheduleId: string; at: number };

/**
 * When a run was due, as ISO 8601 UTC (`{{run.due_at}}`): the cron time a
 * schedule started it for, also when it started late, or the moment of
 * Run now. "" for a run that no schedule started.
 */
export function runDueAt(trigger: RunTrigger | undefined): string {
	return trigger?.kind === "schedule" ? iso(trigger.at) : "";
}
