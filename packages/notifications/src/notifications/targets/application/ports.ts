import type { NewTarget, PushTarget } from "../domain/push-targets";

/**
 * The driven ports of targets. A port of its own has a real adapter,
 * an in-memory adapter and a contract suite in `adapters/out/`. Another
 * package fills a port with `@filledBy`: the composition of the package
 * passes it to `wireTargets`.
 */

/** The push targets each Person registered. */
export type TargetStore = {
	/** The Person's push targets, oldest first. */
	of(personId: string): Promise<PushTarget[]>;
	/** These push targets, by id. An id without a target is left out. */
	byIds(ids: readonly string[]): Promise<PushTarget[]>;
	/** Removes the phones with this push token of every Person but this one. */
	dropPhoneOfOthers(personId: string, endpoint: string): Promise<void>;
	/**
	 * Adds the target, or, when its Person has its endpoint already, gives
	 * that one the new kind, name, platform, keys and session, and marks it
	 * seen. Returns the target as kept, or null when nothing was kept.
	 */
	upsert(target: NewTarget): Promise<PushTarget | null>;
	/** Removes one of the Person's targets. Returns it, or null when the Person has no target of that id. */
	remove(personId: string, id: string): Promise<PushTarget | null>;
	/** Removes these targets. */
	forget(ids: readonly string[]): Promise<void>;
};

/**
 * The sessions of the Persons: a phone is a push target plus its session.
 * @filledBy auth
 */
export type Sessions = {
	/** Which of these sessions are live at `at`. */
	live(sessionIds: readonly string[], at: number): Promise<Set<string>>;
	/** Ends one session of the Person: the phone that holds it is signed out. */
	end(personId: string, sessionId: string): Promise<void>;
};
