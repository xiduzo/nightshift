/**
 * Whether a URL's host names this computer: `localhost`, `127.x.x.x`, or
 * `::1` with or without brackets. A rule of the name only: it resolves
 * nothing. A Host address and the Ollama address both ask it.
 */
export function isLoopbackHost(hostname: string): boolean {
	return (
		hostname === "localhost" ||
		hostname === "[::1]" ||
		hostname === "::1" ||
		/^127\.\d+\.\d+\.\d+$/.test(hostname)
	);
}
