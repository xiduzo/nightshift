import { Refusal } from "@nightshift/refusal";

/** AppleScript's "User canceled." error number. */
const USER_CANCELED = "-128";

/**
 * Whether this computer can show the folder picker: a Mac with `osascript`.
 * A Linux server or the Docker image cannot, so a project comes from GitHub there.
 */
export function canChooseFolder(): boolean {
	return process.platform === "darwin" && Bun.which("osascript") !== null;
}

/**
 * Opens the native macOS folder picker on this Mac and waits for a choice.
 * Returns the absolute path without a trailing slash, or null when the user
 * cancels. The server runs on the user's Mac, so the dialog shows there for
 * the web app and the desktop shell alike.
 */
export async function chooseFolder(prompt: string): Promise<string | null> {
	if (process.platform !== "darwin") {
		throw new Refusal(
			"unavailable",
			"This computer cannot open a folder picker. Add the project from GitHub instead.",
		);
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
		// A failure: the person sees plain words, the details go to the log.
		throw new Error(
			`osascript could not open the folder picker: ${stderr.trim()}`,
		);
	}
	const path = stdout.trim();
	return path.length > 1 ? path.replace(/\/$/, "") : path;
}
