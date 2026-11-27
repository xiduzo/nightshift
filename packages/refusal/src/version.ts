/**
 * The version of what two Night Shifts say to each other (ADR 45): the peer
 * protocol of a Device and its Host, and what the web and phone apps read.
 * Both sides must have the same number. It goes up by one in the change
 * that changes the peer protocol: a test of `@nightshift/devices` fails
 * until it does. It also goes up when an app of the version before can no
 * longer read what the API answers.
 *
 * A difference is never a loss of access. It waits for an update.
 */
export const PROTOCOL_VERSION = 3;

/** How another Night Shift compares with this one, when they differ. */
export type OtherVersion = "older" | "newer";

/**
 * How the version another Night Shift says compares with this one's. Null:
 * the same. One that says no version is older: it comes from before the
 * number.
 */
export function otherVersion(said: unknown): OtherVersion | null {
	if (said === PROTOCOL_VERSION) return null;
	return typeof said === "number" && said > PROTOCOL_VERSION
		? "newer"
		: "older";
}

const OLDER_HERE =
	"This computer runs an older version of Night Shift. Update Night Shift here.";

/** What a person at this computer reads about a Host of another version. */
export function hostVersionWords(host: OtherVersion): string {
	return host === "older"
		? "This Host runs an older version of Night Shift. Update Night Shift there."
		: OLDER_HERE;
}

/** What a person at a Host reads about a computer of another version that asks to connect. */
export function deviceVersionWords(device: OtherVersion): string {
	return device === "older"
		? "It runs an older version of Night Shift. Update Night Shift there."
		: OLDER_HERE;
}

/** What a person reads in an app whose Night Shift has another version. */
export function appVersionWords(
	app: "page" | "phone",
	host: OtherVersion,
): string {
	if (app === "page") return "Night Shift was updated. Reload this page.";
	return host === "older"
		? hostVersionWords("older")
		: "This app is older than Night Shift on your Host. Close the app and open it again to update it.";
}
