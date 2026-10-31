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
 * The files a run changed, per step in the order the steps started: each
 * file with its status and its lines added and removed. No diffs: open the
 * run on your computer for those. It reads what the run screen follows
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
		<Screen onRefresh={refresh}>
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
		</Screen>
	);
}

/** The files of one step, under its name and its line counts. */
function StepFiles({
	title,
	group,
}: {
	title: string;
	group: StepChangedFiles;
}) {
	const count =
		group.files.length === 1 ? "1 file" : `${group.files.length} files`;
	return (
		<View className="gap-3">
			<SectionHead title={title} hint={`${count} · ${linesLabel(group)}`} />
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

/** One file: its name, its folder and status, and "+12 −3". */
function FileRow({ file }: { file: ChangedFile }) {
	const { icon, word } = STATUS[file.status];
	const slash = file.path.lastIndexOf("/");
	const name = file.path.slice(slash + 1);
	const folder = slash > 0 ? file.path.slice(0, slash) : "";
	const lines = file.binary ? null : linesLabel(file.lines);
	return (
		<ListRow
			icon={icon}
			title={name}
			caption={[
				word,
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
