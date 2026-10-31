import {
	type ChangedFile,
	createRunQueries,
	linesLabel,
	mergeSteps,
	nodeLabels,
	type StepChangedFiles,
	stepChangedFiles,
	stepName,
} from "@nightshift/client";
import { Skeleton } from "@nightshift/ui-native/components/ui/skeleton";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	FileMinus,
	FilePen,
	FilePlus,
	FileSymlink,
	Files,
	type LucideIcon,
} from "lucide-react-native";
import { useCallback, useMemo } from "react";
import { View } from "react-native";

import { useHostQueries } from "@/features/host";
import { EmptyState } from "@/shared/empty";
import { ErrorAlert } from "@/shared/feedback";
import { ListGroup, ListRow, SectionHead } from "@/shared/list";
import { Screen } from "@/shared/page";
import { useWhileFocused } from "@/shared/refresh";
import { changesSummary } from "./run-facts";
import { usePhoneLiveRun } from "./use-live-run";

const STATUS: Record<
	ChangedFile["status"],
	{ icon: LucideIcon; word: string }
> = {
	added: { icon: FilePlus, word: "Added" },
	edited: { icon: FilePen, word: "Edited" },
	deleted: { icon: FileMinus, word: "Deleted" },
	renamed: { icon: FileSymlink, word: "Renamed" },
};

/**
 * The files a run changed: the run's title, how many files and lines,
 * and each file with its lines added and removed. When more than one step
 * changed files, they show per step, in the order the steps started. No
 * diffs: those open on the desktop. It reads what the run screen follows
 * already (`usePhoneLiveRun`).
 */
export function ChangesScreen({ runId }: { runId: string }) {
	const runQueries = useHostQueries(createRunQueries);
	const queryClient = useQueryClient();
	const run = useQuery({
		...runQueries.get(runId, queryClient),
		...useWhileFocused(),
	});
	const live = usePhoneLiveRun(runId);
	const steps = useMemo(
		() => mergeSteps(run.data?.steps ?? [], live.steps),
		[run.data?.steps, live.steps],
	);
	const groups = useMemo(
		() =>
			stepChangedFiles(
				live.entries.changes,
				steps.map((step) => step.id),
			),
		[live.entries.changes, steps],
	);
	const labels = useMemo(
		() => (run.data ? nodeLabels(run.data) : new Map<string, string>()),
		[run.data],
	);
	const refresh = useCallback(
		() => queryClient.invalidateQueries({ queryKey: runQueries.getKey(runId) }),
		[queryClient, runQueries, runId],
	);

	const loading =
		groups.length === 0 &&
		(live.connection === "connecting" || run.isPlaceholderData || !run.data);

	return (
		<Screen onRefresh={refresh} summary={run.data?.title}>
			{run.isError && !run.data ? (
				<ErrorAlert
					title="This run did not load"
					message={run.error.message}
					fix="Pull down to try again."
					onRetry={() => void run.refetch()}
				/>
			) : loading ? (
				<>
					<Skeleton className="h-6 w-1/2" />
					<Skeleton className="h-40 w-full rounded-xl" />
				</>
			) : groups.length === 0 ? (
				<EmptyState
					icon={Files}
					title="No changed files"
					description="When a step of this run changes files in the project, they show here."
				/>
			) : (
				<>
					<Text className="font-semibold text-lg tabular-nums">
						{changesSummary(groups)}
					</Text>
					{groups.length === 1 && groups[0] ? (
						<StepFiles group={groups[0]} />
					) : (
						groups.map((group) => {
							const step = steps.find((s) => s.id === group.stepId);
							return (
								<StepFiles
									key={group.stepId}
									title={step ? stepName(step, labels) : group.stepId}
									group={group}
								/>
							);
						})
					)}
					<Text className="text-muted-foreground text-sm">
						The diff opens on the desktop.
					</Text>
				</>
			)}
		</Screen>
	);
}

/** The files of one step: under its name and line counts when `title` is given. */
function StepFiles({
	title,
	group,
}: {
	title?: string;
	group: StepChangedFiles;
}) {
	return (
		<View className="gap-3">
			{title ? (
				<SectionHead title={title} hint={changesSummary([group])} />
			) : null}
			{group.files.length > 0 ? (
				<ListGroup>
					{group.files.map((file) => (
						<FileRow key={file.path} file={file} />
					))}
				</ListGroup>
			) : null}
			{group.omitted > 0 ? (
				<Text className="text-muted-foreground text-sm">
					{group.omitted === 1
						? "1 more file changed. The list was too long to show it."
						: `${group.omitted} more files changed. The list was too long to show them.`}
				</Text>
			) : null}
			{group.overlapped ? (
				<Text className="text-muted-foreground text-sm">
					Other steps ran at the same time. This list can include their changes.
				</Text>
			) : null}
		</View>
	);
}

/** One file: its name, its folder in mono, and "+12 −3". */
function FileRow({ file }: { file: ChangedFile }) {
	const { icon, word } = STATUS[file.status];
	const slash = file.path.lastIndexOf("/");
	const name = file.path.slice(slash + 1);
	const folder = slash > 0 ? file.path.slice(0, slash) : "";
	const lines = file.binary ? null : linesLabel(file.lines);
	return (
		<ListRow
			icon={icon}
			iconLabel={word}
			title={name}
			caption={[
				folder ? { text: folder, mono: true } : "",
				file.binary ? "Binary file" : "",
			]}
			detail={
				file.oldPath ? [{ text: `Was ${file.oldPath}`, mono: true }] : undefined
			}
			value={lines ?? undefined}
			valueLabel={
				lines && file.lines
					? `${file.lines.added} lines added, ${file.lines.removed} removed`
					: undefined
			}
		/>
	);
}
