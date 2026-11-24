import type { AppRouterClient } from "@nightshift/api";

import { keep, readArgs, turnOn } from "./args";
import { agrees, daemonCommand, defaultDaemonUrl } from "./command";

/**
 * `nightshift leave [--yes]`: this computer leaves its home Host (ADR 1).
 * The Host keeps everything, and this computer keeps a Personal of its
 * own with the projects it has and the runs it ran. It says so and asks
 * first. `--yes` skips the question.
 */

export type LeaveOptions = { yes: boolean; daemon: string };

type LeaveResult = Awaited<ReturnType<AppRouterClient["devices"]["leave"]>>;

/** The options of `nightshift leave`. */
export function leaveOptions(
	argv: readonly string[],
	env: Record<string, string | undefined> = process.env,
): LeaveOptions {
	const options: LeaveOptions = { yes: false, daemon: defaultDaemonUrl(env) };
	const yes = turnOn(options, "yes");
	readArgs(argv, {
		flags: { "--yes": yes, "-y": yes },
		values: {
			"--daemon": keep(options, "daemon"),
		},
	});
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

/** The schedules that ran on the Host, and how to run them here. */
function unpinnedLine(count: number): string {
	return count === 1
		? "1 schedule ran on the Host. It is paused here. Turn it on to run it on this computer."
		: `${count} schedules ran on the Host. They are paused here. Turn them on to run them on this computer.`;
}

/** How leaving went. */
export function leaveResultLines(result: LeaveResult): string[] {
	const { host, split } = result;
	const lines = [
		result.told
			? `This computer left ${host.name}.`
			: `This computer left ${host.name}. It did not answer. Remove this computer on its Devices page too.`,
	];
	if (split) {
		lines.push(
			`Your Personal on this computer has ${plural(split.projects, "project")} and ${plural(split.runs, "run")}.`,
		);
		if (split.unpinned > 0) lines.push(unpinnedLine(split.unpinned));
		lines.push(`A copy of your data from before is in ${split.backup}`);
	}
	if (result.waiting !== null) {
		lines.push(
			"Your Personal on this computer is ready when its runs are done.",
		);
	} else if (!split) {
		lines.push("Your Personal stays as it is.");
	}
	if (result.keyKept) {
		lines.push(
			"The old key stays on this computer. Night Shift tries again when it starts.",
		);
	}
	return lines;
}

export const leaveCommand = daemonCommand({
	name: "leave",
	help: `  nightshift leave [--yes]                  Leave the home Host of this computer. The
                                            Host keeps everything. This computer keeps
                                            its own Personal. It asks first.`,
	usage: (program) =>
		`Usage: ${program} [--yes] [--daemon <address>]\nLeaves the home Host of this computer. The Host keeps everything. This computer keeps its own Personal. It asks first.`,
	options: (argv) => leaveOptions(argv),
	run: async (client, { yes }) => {
		const { thisComputer } = await client.devices.list();
		const home = thisComputer?.hosts.find((host) => host.homeHost);
		if (!home) {
			console.log("This computer has no home Host.");
			return;
		}
		console.log(leaveQuestionLines(home.name).join("\n"));
		const agreed = agrees(yes, {
			question: `Leave ${home.name} now?`,
			needsYes: "Add --yes to leave without a question.",
		});
		if (!agreed) {
			console.log("Nothing changed.");
			return;
		}
		const result = await client.devices.leave();
		console.log(leaveResultLines(result).join("\n"));
	},
});
