import type { AppRouterClient } from "@nightshift/api";

import { daemonClient, defaultDaemonUrl } from "./join";

/**
 * `nightshift leave [--yes]`: this computer leaves its home Host (ADR 1).
 * The Host keeps everything, and this computer keeps a Personal of its
 * own with the projects it has and the runs it ran. It says so and asks
 * first. `--yes` skips the question.
 */

export type LeaveOptions = { yes: boolean; daemon: string };

type LeaveResult = Awaited<ReturnType<AppRouterClient["devices"]["leave"]>>;

/** The options of `nightshift leave`, or null for its help. */
export function parseLeave(
	argv: readonly string[],
	env: Record<string, string | undefined> = process.env,
): LeaveOptions | null {
	const args = [...argv];
	const options: LeaveOptions = { yes: false, daemon: defaultDaemonUrl(env) };
	while (args.length > 0) {
		const arg = args.shift() as string;
		if (arg === "--yes" || arg === "-y") options.yes = true;
		else if (arg === "--daemon")
			options.daemon = args.shift() ?? options.daemon;
		else return null;
	}
	return options;
}

const plural = (count: number, one: string, many = `${one}s`) =>
	`${count} ${count === 1 ? one : many}`;

/** What leaving does, before it does it. */
export function leaveQuestionLines(hostName: string): string[] {
	return [
		`This computer leaves ${hostName}. ${hostName} keeps all your projects, flows and runs.`,
		"This computer keeps its own Personal with the projects here, their flows and schedules, and its runs.",
		"Night Shift keeps a copy of your data from before.",
	];
}

/** How leaving went. */
export function leaveResultLines(result: LeaveResult): string[] {
	const { host, split } = result;
	const lines = [
		result.told
			? `This computer left ${host.name}.`
			: `This computer left ${host.name}. It did not answer, so remove this computer on its Devices page too.`,
	];
	if (split) {
		lines.push(
			`Your Personal on this computer has ${plural(split.projects, "project")} and ${plural(split.runs, "run")}.`,
			`A copy of your data from before is in ${split.backup}`,
		);
	}
	if (result.waiting !== null) {
		lines.push(
			"Your Personal on this computer is ready when its runs are done.",
		);
	} else if (!split) {
		lines.push("Your Personal stays as it is.");
	}
	return lines;
}

export async function leaveCommand(argv: string[], program: string) {
	const options = parseLeave(argv);
	if (!options) {
		console.log(
			`Usage: ${program} [--yes] [--daemon <address>]\nLeaves the home Host of this computer. The Host keeps everything. This computer keeps its own Personal. It asks first.`,
		);
		process.exit(2);
	}
	const client = await daemonClient(options.daemon);
	try {
		const { thisComputer } = await client.devices.list();
		const home = thisComputer?.hosts.find(
			(host) => host.role === "home" && host.status !== "revoked",
		);
		if (!home) {
			console.log("This computer has no home Host.");
			return;
		}
		console.log(leaveQuestionLines(home.name).join("\n"));
		if (!options.yes) {
			if (!process.stdin.isTTY) {
				console.error("Add --yes to leave without a question.");
				process.exit(2);
			}
			if (!confirm(`Leave ${home.name} now?`)) {
				console.log("Nothing changed.");
				return;
			}
		}
		const result = await client.devices.leave();
		console.log(leaveResultLines(result).join("\n"));
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	}
}
