import { type ProfileRef, sameProfileRef } from "@nightshift/flows";

/** A node's backups once its profile is `next`: never the profile itself. */
export function backupsWithProfile(
	fallbacks: readonly ProfileRef[] | undefined,
	next: ProfileRef,
): ProfileRef[] | undefined {
	const kept = (fallbacks ?? []).filter(
		(backup) => !sameProfileRef(backup, next),
	);
	return kept.length > 0 ? kept : undefined;
}
