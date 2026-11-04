/**
 * A moment the rest of the engine already has. Telemetry turns it into an
 * anonymous usage event. The fields here are the raw values. Telemetry
 * closes the lists and hashes the ids before anything is stored.
 */
export type UsageMoment =
	| { kind: "flow-created"; from: string; starter?: string }
	| {
			kind: "schedule-changed";
			enabled: boolean;
			webhook: boolean;
			scorePullRequests: boolean;
	  }
	| { kind: "schedule-fired" }
	| { kind: "schedule-skipped"; reason: string }
	| {
			kind: "gate-answered";
			by: "person" | "deadline";
			via: "web" | "phone" | "lock_screen" | "_OTHER";
			waitMs: number;
			hasDeadline: boolean;
			isForm: boolean;
	  }
	| { kind: "pull-request-opened"; runId: string }
	| { kind: "pull-request-outcome"; outcome: string; elapsedMs: number }
	| { kind: "pull-request-useful"; runId: string; useful: boolean }
	| {
			kind: "project-added";
			source: string;
			hasRemote: boolean;
			starters: number;
	  }
	| { kind: "project-checked"; steps: { id: string; status: string }[] }
	| {
			kind: "agent-checked";
			harness: string;
			installed: boolean;
			signIn: "signed_in" | "signed_out" | "unknown";
	  }
	| { kind: "install-started"; entry: string; host: boolean }
	| {
			kind: "install-active";
			agents: number;
			phone: boolean;
			paired: boolean;
			spaces: number;
			members: number;
	  }
	| { kind: "knowledge-document-measured"; projectId: string; bytes: number }
	| { kind: "process-crashed" };

/** Where a moment is noted. Absent means this computer records none. */
export type UsageNotes = {
	note(moment: UsageMoment): void;
};
