import type { TargetStore } from "../../application/ports";
import type { NewTarget, PushTarget } from "../../domain/push-targets";

/**
 * `TargetStore` in memory: one target per endpoint of a Person, kept in
 * the order they were added.
 */
export function inMemoryTargetStore() {
	const targets: PushTarget[] = [];
	const copy = (target: PushTarget): PushTarget => structuredClone(target);
	let keepNothing = false;
	const twin = {
		/** Every target, as the store keeps them. */
		all: () => targets.map(copy),
		/** The next `upsert` keeps nothing and gives null. */
		keepNothingNext() {
			keepNothing = true;
		},
		async of(personId: string) {
			return targets
				.filter((target) => target.personId === personId)
				.sort((a, b) => a.createdAt - b.createdAt)
				.map(copy);
		},
		async byIds(ids: readonly string[]) {
			return targets.filter((target) => ids.includes(target.id)).map(copy);
		},
		async dropPhoneOfOthers(personId: string, endpoint: string) {
			twin.forgetWhere(
				(target) =>
					target.endpoint === endpoint &&
					target.kind === "expo" &&
					target.personId !== personId,
			);
		},
		async upsert(target: NewTarget): Promise<PushTarget | null> {
			if (keepNothing) {
				keepNothing = false;
				return null;
			}
			const { at, ...fields } = target;
			const kept = targets.find(
				(old) =>
					old.personId === target.personId && old.endpoint === target.endpoint,
			);
			if (kept) {
				Object.assign(kept, {
					kind: fields.kind,
					name: fields.name,
					platform: fields.platform,
					keys: fields.keys,
					sessionId: fields.sessionId,
					lastSeenAt: at,
				});
				return copy(kept);
			}
			const added = { ...fields, createdAt: at, lastSeenAt: at };
			targets.push(added);
			return copy(added);
		},
		async remove(personId: string, id: string) {
			const found = targets.find(
				(target) => target.id === id && target.personId === personId,
			);
			if (!found) return null;
			twin.forgetWhere((target) => target === found);
			return copy(found);
		},
		async forget(ids: readonly string[]) {
			twin.forgetWhere((target) => ids.includes(target.id));
		},
		forgetWhere(gone: (target: PushTarget) => boolean) {
			for (let i = targets.length - 1; i >= 0; i--) {
				const target = targets[i];
				if (target && gone(target)) targets.splice(i, 1);
			}
		},
	};
	return twin satisfies TargetStore;
}

export type InMemoryTargetStore = ReturnType<typeof inMemoryTargetStore>;
