/**
 * Who may change a Project's knowledge folder now, in this process. A
 * reconcile scans a whole folder and writes `.reconciled.json`: two at once
 * lose changes, and a scan in the middle of a sync publishes half of what
 * it writes. So reconciles and moves of one folder take turns, and while a
 * step holds a folder, only the steps reconcile it.
 *
 * The locks belong to the folders, not to the module that reconciles them.
 * A `bun --hot` reload evaluates every module again, and a step that started
 * before the reload still writes its folder and still has its hold. A map in
 * `reconcile.ts` would start empty beside that step. The daemon keeps one
 * `KnowledgeFolderLocks` across reloads (`nightshiftKnowledgeFolderLocks`),
 * and every `Knowledge` of the process uses it.
 */
export type KnowledgeFolderLocks = {
	/** Runs `change` after every turn of the folder before it. */
	inTurn<T>(root: string, change: () => Promise<T>): Promise<T>;
	/** Resolves when the turns of the folder so far have ended. */
	turnsEnded(root: string): Promise<void>;
	/** A step holds the folder. True for the first hold: nothing held it before. */
	hold(root: string): boolean;
	/** A step lets go of the folder. True for the last hold: nothing holds it now. */
	release(root: string): boolean;
	/** Whether a step holds the folder now. */
	held(root: string): boolean;
};

export function createKnowledgeFolderLocks(): KnowledgeFolderLocks {
	const turns = new Map<string, Promise<unknown>>();
	const holds = new Map<string, number>();
	return {
		inTurn(root, change) {
			const before = turns.get(root) ?? Promise.resolve();
			const run = before.catch(() => {}).then(change);
			turns.set(root, run);
			const forget = () => {
				if (turns.get(root) === run) turns.delete(root);
			};
			run.then(forget, forget);
			return run;
		},
		async turnsEnded(root) {
			await turns.get(root)?.catch(() => {});
		},
		hold(root) {
			const held = holds.get(root) ?? 0;
			holds.set(root, held + 1);
			return held === 0;
		},
		release(root) {
			const left = (holds.get(root) ?? 1) - 1;
			if (left > 0) {
				holds.set(root, left);
				return false;
			}
			holds.delete(root);
			return true;
		},
		held: (root) => (holds.get(root) ?? 0) > 0,
	};
}
