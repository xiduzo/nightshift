import { keep, readArgs, required, turnOn } from "./args";
import { agrees, daemonCommand, defaultDaemonUrl } from "./command";
import { previewLines, resultLines } from "./merge-words";

/**
 * `nightshift merge [--dry-run] [--join <project>]... [--yes]`: merges this
 * computer's Personal into the Personal of its home Host (ADR 1), for a
 * computer that joined before the merge existed, or a merge that stopped.
 * It shows what the merge does first and asks before it changes
 * anything. `--dry-run` only shows it. `--join <project>` moves a
 * project into the project of a shared Space with its repository, where
 * that Space's members see its runs. `--yes` skips the question.
 */

export type MergeOptions = {
	dryRun: boolean;
	yes: boolean;
	/** The projects to move into the project of a shared Space, by name or id. */
	join: string[];
	daemon: string;
};

/** The options of `nightshift merge`. */
export function mergeOptions(
	argv: readonly string[],
	env: Record<string, string | undefined> = process.env,
): MergeOptions {
	const options: MergeOptions = {
		dryRun: false,
		yes: false,
		join: [],
		daemon: defaultDaemonUrl(env),
	};
	const yes = turnOn(options, "yes");
	readArgs(argv, {
		flags: {
			"--dry-run": turnOn(options, "dryRun"),
			"--yes": yes,
			"-y": yes,
		},
		values: {
			"--join": required((project) => {
				options.join.push(project);
			}),
			"--daemon": keep(options, "daemon"),
		},
	});
	return options;
}

export const mergeCommand = daemonCommand({
	name: "merge",
	help: `  nightshift merge [--dry-run] [--yes]      Merge the Personal of this computer into
                                            the Personal of its home Host. It shows
                                            what moves and asks first.`,
	usage: (program) =>
		`Usage: ${program} [--dry-run] [--join <project>]... [--yes] [--daemon <address>]\nMerges the Personal of this computer into the Personal of its home Host. It shows what moves and asks first.\n--dry-run only shows it. --join moves a project into the project with its repository in a shared Space.`,
	options: (argv) => mergeOptions(argv),
	run: async (client, options) => {
		const pending = await client.devices.merge.pending();
		if (!pending.pending) {
			console.log("There is nothing to merge: this computer has one Personal.");
			return;
		}
		const first = await client.devices.merge.preview({});
		const join = first.projects
			.filter(
				(p) => options.join.includes(p.id) || options.join.includes(p.name),
			)
			.map((p) => p.id);
		const unknown = options.join.filter(
			(name) => !first.projects.some((p) => p.id === name || p.name === name),
		);
		if (unknown.length > 0) {
			console.error(`Personal has no project ${unknown.join(", ")}.`);
			process.exit(2);
		}
		const preview =
			join.length > 0 ? await client.devices.merge.preview({ join }) : first;
		console.log(previewLines(preview).join("\n"));
		if (preview.projects.some((p) => p.into === "apart")) {
			console.log(
				"To move a project into the shared project with its repository, add --join <project>.",
			);
		}
		if (options.dryRun) return;
		const agreed = agrees(options.yes, {
			question: "Merge Personal now?",
			needsYes: "Add --yes to merge without a question.",
		});
		if (!agreed) {
			console.log("Nothing changed.");
			return;
		}
		const result = await client.devices.merge.run({ join });
		console.log(resultLines(result, preview.host.name).join("\n"));
	},
});
