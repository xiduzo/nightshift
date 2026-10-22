/**
 * A Host address, as the person types it or scans it. Pure: no storage, so
 * tests run it without the phone.
 */

/** Whether this build may talk to a Host over plain `http://`: development only. */
function inDevelopment(): boolean {
	return typeof __DEV__ !== "undefined" && __DEV__;
}

/**
 * The origin of what the person typed: `nightshift.example.com` becomes
 * `https://nightshift.example.com`. Null when it is no web address. Every
 * request carries the session cookie, so a Host needs `https://`. Only a
 * development build also takes `http://`.
 */
export function hostAddressOf(
	input: string,
	options: { allowHttp?: boolean } = {},
): string | null {
	const allowHttp = options.allowHttp ?? inDevelopment();
	const text = input.trim();
	if (!text) return null;
	const withScheme = /^[a-z]+:\/\//i.test(text) ? text : `https://${text}`;
	try {
		const url = new URL(withScheme);
		if (url.protocol === "https:") return url.origin;
		if (url.protocol === "http:" && allowHttp) return url.origin;
		return null;
	} catch {
		return null;
	}
}

/** Whether the address is refused only because it is `http://`: the person needs to hear why. */
export function needsHttps(input: string): boolean {
	return /^http:\/\//i.test(input.trim()) && hostAddressOf(input) === null;
}
