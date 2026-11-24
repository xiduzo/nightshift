import {
	type CliToolRef,
	type FlowNode,
	programsWithoutLogin,
} from "@nightshift/flows";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { cliToolQueries } from "@/features/agents";
import type { CliTool } from "@/shared/api";

import { programWithoutLoginMessage } from "../../draft";

/** A CLI tool on this computer, as `cliTools.list` returns it. */
export type DaemonCliTool = CliTool;

/**
 * The CLI tools as the flow check reads them (`refs`), and the ones a
 * command can call by name (`forCommands`): those with a login. Both are
 * undefined while they load.
 */
export function useCommandTools(): {
	refs: CliToolRef[] | undefined;
	forCommands: DaemonCliTool[] | undefined;
} {
	const { data } = useQuery({
		...cliToolQueries.list(),
		staleTime: 30_000,
		meta: { quietErrors: true },
	});
	return useMemo(
		() => ({
			refs: data?.map((tool) => ({
				name: tool.name,
				program: tool.program,
				signsIn: tool.login !== null,
			})),
			forCommands: data?.filter((tool) => tool.login !== null),
		}),
		[data],
	);
}

/**
 * For the field of a node's command: the CLI tools to insert, and what to
 * fix when the command calls a program without the login of its tool.
 */
export function useCommandToolField(node: FlowNode): {
	tools: DaemonCliTool[] | undefined;
	error: string | null;
} {
	const { refs, forCommands } = useCommandTools();
	const found = refs ? programsWithoutLogin(node, refs) : [];
	return {
		tools: forCommands,
		error:
			found.length > 0
				? found
						.map(({ program, tools }) =>
							programWithoutLoginMessage(program, tools),
						)
						.join(" ")
				: null,
	};
}

/** What the editor says about a CLI tool Night Shift does not have. */
export function missingCliToolMessage(name: string): string {
	return `There is no CLI tool named ${name}. The run does not start. Add it under Settings → Tools, or remove it here.`;
}
