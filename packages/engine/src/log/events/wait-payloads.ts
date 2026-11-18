import type { WaitUntil } from "@nightshift/flows";
import type { ResumedBy } from "./run";
import type { Scope } from "./step";

/**
 * The events of a wait and of a hold, and the words their payloads use: a
 * step that waits, and the leases and services a run holds.
 */

/** Why the run policy waits: a usage limit, or the network. */
export type PolicyWaitReason = "usage-limit" | "network";
/**
 * Why a step waits: the run policy, or what a Wait node waits for (a
 * duration, a time, a command that passes, a signal).
 */
export type WaitReason =
	| PolicyWaitReason
	| WaitUntil["kind"]
	/** The step's Device is offline: it starts when the Device is back. */
	| "device-offline"
	/** A Lease node waits for a lease another run holds, or for the Host that keeps it. */
	| "lease";

/** The Section a lease holds for (`LeaseTaken.section`): its id, and every node in it. */
export type HoldSection = { id: string; nodes: readonly string[] };

/**
 * A service as its node rendered it (ADR 9): the commands get their
 * template values as environment variables (`env`), and the Device adds
 * the `secrets` by name. What a resume starts again and what stops it.
 */
export type ServiceSpec = {
	start: string;
	/** Ready when this command exits 0, or when this URL answers 2xx. */
	ready: { command: string } | { url: string };
	everySeconds: number;
	timeoutMinutes: number;
	/** Null: the engine ends the process group. */
	stop: string | null;
	env: Record<string, string>;
	secrets?: string[];
};

/** The lease a Lease node waits for (`WaitStarted.lease`). */
export type LeaseWait = {
	name: string;
	/** The run that holds it. Null while the Host that keeps it cannot be reached. */
	holder: string | null;
	holderTitle: string | null;
};

export type WaitPayloads = {
	/**
	 * A step waits for a usage limit to reset or for the network, or a Wait
	 * node waits for what it was told to. The step stays open and the run
	 * sleeps. A fact, not a timer: a new daemon rebuilds the timer from it.
	 */
	WaitStarted: {
		reason: WaitReason;
		/** Epoch ms when the step continues. Null for a wait with no time: a signal with no timeout. */
		until: number | null;
		message: string;
		/** Epoch ms of the first wait of this streak (the network grace counts from it). */
		since: number;
		/** A Wait node on a signal: the signal's name. */
		signal?: string;
		/**
		 * A Wait node on a signal with a `key`: the key, rendered. Only a
		 * webhook signal with the same key wakes it. Absent: any does.
		 */
		signalKey?: string;
		/**
		 * A Wait node on a signal whose outcomes have rules: the rules, in
		 * order. A webhook signal that matches none does not wake it.
		 * Absent: any signal of the name does.
		 */
		signalRules?: { outcome: string; when: string }[];
		/** The Device the step waits for or on: a usage limit is its harness login's. */
		deviceId?: string;
		/** `device-offline`: the name of the Device it waits for, for a notification. */
		deviceName?: string;
		/** `lease`: the lease it waits for, and the run that holds it (null: the Host cannot be reached). */
		lease?: LeaseWait;
	};
	/**
	 * A Lease node's step took the lease `name` of the run's Space (ADR 7).
	 * The run holds it until it leaves its Section, or until it ends.
	 * Logged on the step, in the scope of the flow the node is in. A run
	 * that resumes takes its leases again: then on no step, with `again`.
	 */
	LeaseTaken: {
		name: string;
		nodeId: string;
		ttlMinutes: number;
		/** The scope of the flow the node is in. Null at the top level. */
		scope: Scope | null;
		/** The Section the lease holds for, with every node in it. Absent: the run. */
		section?: HoldSection;
		/** A resumed run took the lease again. */
		again?: true;
	};
	/**
	 * The run let go of the lease `name` before its end. `scope`: it left
	 * the lease's Section. `person`: a person released it by hand.
	 * `expired`: the lease expired while the run lived, because its Host
	 * did not hear from this Device for its ttl.
	 */
	LeaseReleased: { name: string; why: "scope" | "person" | "expired" };
	/**
	 * A Service node's step started its service (ADR 9): a process that
	 * runs in the background on the step's Device until the run leaves the
	 * scope. Logged on the step, before the probe says it is ready, so the
	 * engine can stop it whatever happens next. `spec` holds what a resume
	 * runs again and what stops it. A run that resumes starts its services
	 * again: then on no step, with `again`.
	 */
	ServiceStarted: {
		nodeId: string;
		/** The scope of the flow the node is in. Null at the top level. */
		scope: Scope | null;
		/** The Section the service lives for, with every node in it. Absent: the run. */
		section?: HoldSection;
		/** The Device the service runs on. */
		deviceId: string;
		/** Where it runs: the run's worktree on that Device. */
		cwd: string;
		/** The service's log, on the computer that walks the run. */
		logPath: string;
		/** The process id, which is its process group's too. Null: the Device did not say. */
		pid: number | null;
		/** When the process started, as `ps -o lstart=` says: a stop after a restart checks it. */
		startedAt: string | null;
		spec: ServiceSpec;
		/** A resumed run started the service again. */
		again?: true;
	};
	/**
	 * The run stopped a service before its end. `scope`: it left the
	 * service's Section. `failed`: the service did not get ready.
	 * `stopped`: its step stopped before the service was ready.
	 */
	ServiceStopped: {
		nodeId: string;
		scope: Scope | null;
		why: "scope" | "failed" | "stopped";
	};
	/**
	 * The wait is over: the step continues. `early` when a person resumed
	 * the run, a signal arrived, or Night Shift looked again (a Device came
	 * back, a lease went); `signal` when one arrived. `by`: who ended it
	 * early without a signal. Absent in older logs, on a signal and on a
	 * timer.
	 */
	WaitEnded: { early: boolean; signal?: string; by?: ResumedBy };
};
