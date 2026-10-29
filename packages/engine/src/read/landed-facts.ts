import type {
	EngineEventType,
	LandedRunEvent,
	RunEnding,
	WaitReason,
} from "../log";

/**
 * What each run event that lands in this Replica means to the readers of
 * the landed feed outside the engine: the notifier, keep this computer
 * awake, the exchange's wait for new rows. Derived once here, from the
 * parsed log, so a reader never reads an event's type name or payload. An
 * event of an older Walker is upgraded before it lands, so its fact is
 * the same.
 */

/** What of a run a landed event changes. */
export type LandedChange =
	/** What a list of runs shows: the status, the step that runs, the Walker, a stop that waits. */
	| "summary"
	/** Only what the run's page shows. */
	| "detail"
	/** Only what the run spent so far: no reader needs to wake for it. */
	| "spend";

/** One run event that landed, as a reader of the landed feed needs it. */
export type LandedFact = {
	spaceId: string;
	runId: string;
	/** The event's seq: a run's end is told once per end. */
	seq: number;
	changes: LandedChange;
} & (
	| { kind: "gate-opened"; stepId: string }
	| {
			kind: "wait-started";
			stepId: string;
			reason: WaitReason;
			/** `device-offline`: the Device's name, as the Walker said it. Null: none, or a Walker of an older version. */
			deviceName: string | null;
	  }
	| { kind: "wait-ended"; stepId: string }
	| { kind: "step-ended"; stepId: string }
	| { kind: "run-ended"; status: RunEnding }
	/** Any other event of the run. */
	| { kind: "other" }
);

/** The run events that change what a list of runs shows. */
const SUMMARY_CHANGES: ReadonlySet<EngineEventType> = new Set([
	"RunStarted",
	"RunResumed",
	"RunEnded",
	"StepStarted",
	"StepReopened",
	"StepEnded",
	"GateOpened",
	"WaitStarted",
	"WaitEnded",
	"WalkerMoved",
	"HandedOff",
	"StopRequested",
	"StopAfterStepRequested",
	"StopAfterStepCancelled",
]);

function changeOf(type: EngineEventType): LandedChange {
	if (type === "SessionUsage") return "spend";
	return SUMMARY_CHANGES.has(type) ? "summary" : "detail";
}

/** The facts of one landing, in its order: one per event. */
export function landedFacts(events: readonly LandedRunEvent[]): LandedFact[] {
	return events.map(landedFact);
}

function landedFact(e: LandedRunEvent): LandedFact {
	const base = {
		spaceId: e.spaceId,
		runId: e.runId,
		seq: e.seq,
		changes: changeOf(e.type),
	};
	if (e.type === "RunEnded") {
		return { ...base, kind: "run-ended", status: e.payload.status };
	}
	const stepId = e.stepId;
	if (stepId === null) return { ...base, kind: "other" };
	switch (e.type) {
		case "GateOpened":
			return { ...base, kind: "gate-opened", stepId };
		case "WaitStarted":
			return {
				...base,
				kind: "wait-started",
				stepId,
				reason: e.payload.reason,
				deviceName: e.payload.deviceName || null,
			};
		case "WaitEnded":
			return { ...base, kind: "wait-ended", stepId };
		case "StepEnded":
			return { ...base, kind: "step-ended", stepId };
		default:
			return { ...base, kind: "other" };
	}
}
