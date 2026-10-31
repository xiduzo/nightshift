import { createKnowledgeQueries } from "@nightshift/client";
import { useQuery } from "@tanstack/react-query";
import type { Href } from "expo-router";
import { Lightbulb } from "lucide-react-native";

import { useHostQueries } from "@/features/host";
import { ListRow } from "@/shared/list";
import { useWhileFocused } from "@/shared/refresh";
import { waitingText } from "./waiting";

function countOf(list: readonly unknown[]): number {
	return list.length;
}

/**
 * How many learnings wait: of one project, or of every project. Undefined
 * while they load, when they did not load, or on a Host of an older
 * version, which does not list them: then the row stays out. The screen
 * renders again only when the count changes.
 */
export function useWaitingLearnings(projectId?: string): number | undefined {
	const knowledge = useHostQueries(createKnowledgeQueries);
	return useQuery({
		...knowledge.learnings(projectId),
		select: countOf,
		...useWhileFocused(),
	}).data;
}

/**
 * The row to the learnings that wait, in a ListGroup, with their count
 * (`useWaitingLearnings`). Of one project with `projectId`, else of every
 * project.
 */
export function LearningsRow({
	projectId,
	count,
}: {
	projectId?: string;
	count: number;
}) {
	const href: Href =
		projectId === undefined
			? "/learnings"
			: { pathname: "/learnings", params: { projectId } };
	return (
		<ListRow
			icon={Lightbulb}
			tone={count > 0 ? "needs-input" : undefined}
			title="Learnings"
			caption={count > 0 ? waitingText(count) : "Nothing new to keep or delete"}
			value={String(count)}
			valueLabel={waitingText(count)}
			href={href}
			accessibilityHint="Opens the learnings, to keep or delete them"
		/>
	);
}
