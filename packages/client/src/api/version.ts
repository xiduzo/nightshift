import { appVersionWords, otherVersion } from "@nightshift/refusal";

/**
 * What a person reads in an app whose Night Shift has another version (ADR
 * 45), from the `version` of `account.status`. Null: nothing to say. Null
 * also while that answer says nothing (`null`): the person may not use the
 * Host yet. An answer without a version comes from an older Night Shift.
 */
export function versionMessage(
	app: "page" | "phone",
	said: number | null | undefined,
): string | null {
	if (said === null) return null;
	const host = otherVersion(said);
	return host ? appVersionWords(app, host) : null;
}
