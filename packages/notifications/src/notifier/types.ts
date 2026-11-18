import type { InAppChannel, PushChannels } from "../channels";
import type { DeliveryLog } from "../deliveries";
import type { SettingsStore } from "../settings";
import type { TargetStore } from "../targets";
import type { RunEventSource } from "./sources";

/** What the notifier reads and sends through (`NotifierDeps`), and the notifier as its owner drives it (`Notifier`). */

export type NotifierDeps = {
	events: RunEventSource;
	/** Who may see the runs of the Space. */
	audience(spaceId: string): Promise<string[]>;
	/** Every Space on this Replica: their open Gates are the baseline. */
	spaces(): Promise<string[]>;
	/** Whether this daemon sends the pushes of the Space (`oneSenderPerSpace`). */
	sendsFor(spaceId: string): Promise<boolean>;
	/**
	 * Whether the Person's role in the Space allows an answer to a Gate.
	 * Default: nobody, so no push carries a Gate's options.
	 */
	mayAnswer?(spaceId: string, personId: string): Promise<boolean>;
	settings: Pick<SettingsStore, "get">;
	targets: Pick<TargetStore, "of" | "byIds" | "forget">;
	deliveries: DeliveryLog;
	inApp: InAppChannel;
	push: PushChannels;
	now?: () => number;
	/** How often held pushes and the end of quiet hours are checked. Default 15 s. */
	tickMs?: number;
	/** Where errors go. Default: the console. */
	onError?: (message: string, error: unknown) => void;
};

export type Notifier = {
	/**
	 * Listens at once, and reads the open Gates first: the events that land
	 * meanwhile wait for that read. Resolves once it is done.
	 */
	start(): Promise<void>;
	/** Stops listening and checking. What was held stays in the log. */
	stop(): void;
	/** Sends what is due: held pushes, and the end of quiet hours. */
	tick(): Promise<void>;
	/**
	 * A command of the run was kept for the Device that walks it, or that
	 * Device applied or refused it. Reads the run's Gates again: a Gate
	 * with an answer on its way closes everywhere now.
	 */
	commandsChanged(spaceId: string, runId: string): Promise<void>;
	/** Resolves once every piece of work so far is done. For tests. */
	idle(): Promise<void>;
};
