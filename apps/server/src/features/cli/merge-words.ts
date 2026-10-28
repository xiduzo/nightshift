import type { AppRouterClient } from "@nightshift/api";

/**
 * The words of a merge of this computer's Personal into its home Host's
 * (ADR 1), as the CLI prints them: after `nightshift join`.
 */

type MergePreview = Awaited<
	ReturnType<AppRouterClient["devices"]["merge"]["preview"]>
>;
type MergeResult = Awaited<
	ReturnType<AppRouterClient["devices"]["merge"]["run"]>
>;

const plural = (count: number, one: string, many = `${one}s`) =>
	`${count} ${count === 1 ? one : many}`;

/** What the merge does, one line per project. */
export function previewLines(preview: MergePreview): string[] {
	const lines = [
		`Your Personal merges into the Personal of ${preview.host.name}. ${plural(preview.projects.length, "project")} and ${plural(preview.runs, "run")} move:`,
	];
	for (const project of preview.projects) {
		const label = project.remote
			? `${project.name} (${project.remote})`
			: project.name;
		const where = {
			new: "a project of its own",
			"same-remote": `joins the project with this repository on ${preview.host.name}`,
			shared: `joins the project with this repository in ${project.sharedSpace?.name}`,
			apart: `stays apart from the project with this repository in ${project.sharedSpace?.name}`,
		}[project.into];
		lines.push(`  - ${label}: ${plural(project.runs, "run")}, ${where}`);
		for (const flow of project.renamedFlows) {
			lines.push(`      flow "${flow.from}" is now "${flow.to}"`);
		}
		if (project.schedules > 0) {
			lines.push(
				`      ${plural(project.schedules, "schedule")} ${project.schedules === 1 ? "keeps" : "keep"} firing on this computer`,
			);
		}
	}
	return lines;
}

/** How the merge went. */
export function resultLines(result: MergeResult, hostName: string): string[] {
	const lines = [
		`Personal is merged: ${plural(result.projects, "project")} moved.`,
		`A copy of your data from before the merge is in ${result.backup}`,
	];
	if (result.state !== "pushed") {
		lines.push(`Your runs go to ${hostName} as soon as it answers.`);
	}
	return lines;
}
