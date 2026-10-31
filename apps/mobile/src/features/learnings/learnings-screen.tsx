import {
	createKnowledgeQueries,
	createProjectQueries,
	isMissingOnHost,
} from "@nightshift/client";
import { Skeleton } from "@nightshift/ui-native/components/ui/skeleton";
import type { ListRenderItemInfo } from "@shopify/flash-list";
import { useQuery } from "@tanstack/react-query";
import { Lightbulb } from "lucide-react-native";
import { useCallback, useMemo } from "react";

import { useHostQueries } from "@/features/host";
import { EmptyState } from "@/shared/empty";
import { ErrorAlert } from "@/shared/feedback";
import { type Cell, CellSeparator, cellsOf, ListCell } from "@/shared/list";
import { ScreenList } from "@/shared/page";
import { useScreenRefresh, useWhileFocused } from "@/shared/refresh";
import { LearningRow } from "./learning-row";
import { useSettleLearnings } from "./use-settle";
import {
	type Learning,
	learningKey,
	stillWaiting,
	waitingText,
} from "./waiting";

/**
 * The learnings agents proposed that wait for you, newest first: of one
 * project, or of every project of the Space. Keep one, and agents read it
 * in later runs. Delete one, and it is gone. Either shows at once.
 */
export function LearningsScreen({ projectId }: { projectId?: string }) {
	const knowledge = useHostQueries(createKnowledgeQueries);
	const projectQueries = useHostQueries(createProjectQueries);
	const learnings = useQuery({
		...knowledge.learnings(projectId),
		...useWhileFocused(),
	});
	const projects = useQuery({ ...projectQueries.list(), ...useWhileFocused() });
	const refresh = useScreenRefresh([learnings.refetch, projects.refetch]);
	const { settled, failure, onKeep, onDelete } = useSettleLearnings();

	const projectNames = useMemo(
		() => new Map((projects.data ?? []).map((p) => [p.id, p.name])),
		[projects.data],
	);
	const shown = useMemo(
		() => (learnings.data ? stillWaiting(learnings.data, settled) : undefined),
		[learnings.data, settled],
	);
	const cells = useMemo(() => cellsOf(shown ?? []), [shown]);
	const renderLearning = useCallback(
		({ item }: ListRenderItemInfo<Cell<Learning>>) => (
			<ListCell first={item.first} last={item.last}>
				<LearningRow
					learning={item.item}
					projectName={
						projectId === undefined
							? (projectNames.get(item.item.projectId) ?? null)
							: null
					}
					onKeep={onKeep}
					onDelete={onDelete}
				/>
			</ListCell>
		),
		[projectId, projectNames, onKeep, onDelete],
	);

	const projectName = projectId ? projectNames.get(projectId) : undefined;
	const summary =
		shown && shown.length > 0
			? [projectName, waitingText(shown.length)].filter(Boolean).join(" · ")
			: projectName;
	const missing = learnings.isError && isMissingOnHost(learnings.error);

	return (
		<ScreenList
			data={cells}
			renderItem={renderLearning}
			keyExtractor={cellKey}
			ItemSeparatorComponent={CellSeparator}
			onRefresh={refresh}
			summary={summary}
			header={
				<>
					{failure ? (
						<ErrorAlert
							title={failure.title}
							message={failure.message}
							fix="Check that this phone is online, then try again."
						/>
					) : null}
					{shown ? (
						shown.length === 0 ? (
							<EmptyState
								icon={Lightbulb}
								title="No learnings wait for you"
								description="When an agent learns something about a project, it waits here. Keep what is right, and agents read it in later runs."
							/>
						) : null
					) : missing ? (
						<EmptyState
							icon={Lightbulb}
							title="Learnings are not on this Host yet"
							description="Ask the owner of the Host to update Night Shift. Until then, keep or delete learnings on your computer."
						/>
					) : learnings.isError ? (
						<ErrorAlert
							title="The learnings did not load"
							message={learnings.error.message}
							fix="Check that this phone is online, then try again."
							onRetry={() => void learnings.refetch()}
						/>
					) : (
						<Skeleton className="h-48 w-full rounded-xl" />
					)}
				</>
			}
		/>
	);
}

function cellKey(cell: Cell<Learning>): string {
	return learningKey(cell.item);
}
