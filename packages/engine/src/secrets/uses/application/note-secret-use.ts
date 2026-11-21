import type { SecretFacts } from "../../scopes";
import { dueUses } from "../domain/secret-uses";

export type NoteSecretUsePorts = {
	facts: Pick<SecretFacts, "usedAt" | "writeUsed">;
	now: () => number;
};

/**
 * Notes that Night Shift read these secrets to use them. Writes the
 * document at most once a minute per name, and never holds up the use: a
 * failed write is logged by the document, and a lost time is fine. Names
 * and times only.
 */
export const noteSecretUse =
	(ports: NoteSecretUsePorts) =>
	(names: Iterable<string>): void => {
		const next = dueUses(ports.facts.usedAt(), names, ports.now());
		if (next === null) return;
		ports.facts.writeUsed(next).catch(() => {});
	};
