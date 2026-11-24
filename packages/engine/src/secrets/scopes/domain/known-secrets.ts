import { messageOf } from "@nightshift/refusal";
import { notReadLine } from "./secret-words";

/**
 * What this computer remembers of the secrets between two uses: names,
 * never values. The wire makes it once (decision 21).
 */
export type KnownSecrets = {
	/**
	 * The Personal secret names as this computer last read them, with when
	 * each was set: for `secretSource`, and to fail closed on a name that
	 * is Personal while the Personal secrets cannot be read.
	 */
	readonly personal: Map<string, number>;
	/**
	 * The Project secret names as this computer last read them, of one
	 * Project: to fail closed on a name that is the Project's while they
	 * cannot be read.
	 */
	projectNamesOf(projectId: string): Set<string>;
	/**
	 * Logs why the Personal or the Project secrets could not be listed or
	 * read, once until the reason changes: an older or offline Home Host
	 * would log every use. The line names the scope and the error, never a
	 * value.
	 */
	warnOnce(
		what: "listed" | "read",
		error: unknown,
		scope?: "Personal" | "Project",
	): void;
	/** The Personal secrets answered: the next failure logs again. */
	answered(): void;
	/** Tells the listeners that a Personal secret changed here. */
	personalChanged(): void;
	/** Calls `listener` after a Personal change made here. Returns the unsubscribe. */
	onPersonalChange(listener: () => void): () => void;
};

/** The memory of one computer's secrets. `warn` writes a log line, with the error after it. */
export function createKnownSecrets(
	warn: (line: string, error: unknown) => void,
): KnownSecrets {
	const personal = new Map<string, number>();
	const projectNames = new Map<string, Set<string>>();
	const listeners = new Set<() => void>();
	let lastWarning = "";
	return {
		personal,
		projectNamesOf(projectId) {
			let names = projectNames.get(projectId);
			if (!names) {
				names = new Set();
				projectNames.set(projectId, names);
			}
			return names;
		},
		warnOnce(what, error, scope = "Personal") {
			const reason = `${scope} ${what}: ${messageOf(error)}`;
			if (reason === lastWarning) return;
			lastWarning = reason;
			warn(notReadLine(what, scope), error);
		},
		answered() {
			lastWarning = "";
		},
		personalChanged() {
			for (const listener of listeners) listener();
		},
		onPersonalChange(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
}
