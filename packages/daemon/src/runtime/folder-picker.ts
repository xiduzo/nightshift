/** AppleScript's "User canceled." error number. */
const USER_CANCELED = "-128";

/**
 * Opens the native macOS folder picker on this Mac and waits for a choice.
 * Returns the absolute path without a trailing slash, or null when the user
 * cancels. The server runs on the user's Mac, so the dialog shows there for
 * the web app and the desktop shell alike.
 */
export async function chooseFolder(prompt: string): Promise<string | null> {
	if (process.platform !== "darwin") {
		throw new Error("Choosing a folder is only supported on macOS.");
	}
	const proc = Bun.spawn(
		[
			"osascript",
			// Bring the dialog to the front, over the browser or desktop window.
			"-e",
			"activate",
			"-e",
			`POSIX path of (choose folder with prompt ${JSON.stringify(prompt)})`,
		],
		{ stdin: "ignore", stdout: "pipe", stderr: "pipe" },
	);
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	if (exitCode !== 0) {
		if (stderr.includes(USER_CANCELED)) return null;
		throw new Error(`Could not open the folder picker: ${stderr.trim()}`);
	}
	const path = stdout.trim();
	return path.length > 1 ? path.replace(/\/$/, "") : path;
}
