import type {
	AgentSessionInput,
	SessionContribution,
	StepReportSpec,
} from "./types";

const joined = (texts: readonly (string | undefined)[]) =>
	texts.filter((text) => text !== undefined).join("\n\n");

/**
 * One session's input from what each part of Night Shift adds to it, in the
 * order they are given. A later `env` value wins. Lists and texts keep their
 * order. A field nothing adds stays out of the result.
 */
export function foldContributions(
	session: Pick<AgentSessionInput, "prompt" | "stepReport">,
	contributions: readonly SessionContribution[],
): Pick<
	AgentSessionInput,
	| "prompt"
	| "stepReport"
	| "env"
	| "addDirs"
	| "instructions"
	| "tools"
	| "toolsInstruction"
> {
	const env: Record<string, string> = Object.assign(
		{},
		...contributions.map((added) => added.env),
	);
	const report: Pick<StepReportSpec, "learnings"> = Object.assign(
		{},
		...contributions.map((added) => added.report),
	);
	const addDirs = contributions.flatMap((added) => added.addDirs ?? []);
	const tools = contributions.flatMap((added) => added.tools ?? []);
	const instructions = joined(contributions.map((added) => added.instructions));
	const toolsInstruction = joined(
		contributions.map((added) => added.toolsInstruction),
	);
	const { prompt, stepReport } = session;
	return {
		prompt: joined([
			prompt,
			...contributions.map((added) => added.afterPrompt),
		]),
		...(Object.keys(env).length > 0 ? { env } : {}),
		...(addDirs.length > 0 ? { addDirs } : {}),
		...(instructions ? { instructions } : {}),
		...(tools.length > 0 ? { tools } : {}),
		...(toolsInstruction ? { toolsInstruction } : {}),
		// A session without a report stays without one.
		...(stepReport
			? {
					stepReport:
						Object.keys(report).length > 0
							? { ...(stepReport === true ? {} : stepReport), ...report }
							: stepReport,
				}
			: {}),
	};
}
