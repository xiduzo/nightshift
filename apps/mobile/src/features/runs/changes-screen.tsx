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
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	FileMinus,
	FilePen,
	FilePlus,
	FileSymlink,
	Files,
} from "lucide-react-native";
import { useCallback, useMemo } from "react";
import { View } from "react-native";

import { useHostQueries } from "@/features/host";
import { ErrorAlert } from "@/shared/feedback";
import {
	NativeCustomRow,
	type NativeIcon,
	NativeList,
	NativeRow,
	NativeSection,
	NativeTitleRow,
} from "@/shared/native-list";
import { useWhileFocused } from "@/shared/refresh";
import { useThemeColors } from "@/shared/theme";
import { changesSummary } from "./run-facts";
import { usePhoneLiveRun } from "./use-live-run";

const STATUS: Record<
	ChangedFile["status"],
	{ icon: NativeIcon; word: string }
> = {
	added: { icon: { sf: "doc.badge.plus", lucide: FilePlus }, word: "Added" },
	edited: { icon: { sf: "pencil.line", lucide: FilePen }, word: "Edited" },
	deleted: {
		icon: { sf: "minus.circle", lucide: FileMinus },
		word: "Deleted",
	},
	renamed: {
		icon: { sf: "arrow.right.doc.on.clipboard", lucide: FileSymlink },
		word: "Renamed",
	},
};

/**
 * The files a run changed, as a native grouped list: the run's title,
 * how many files and lines, and each file with its lines added and
 * removed. When more than one step changed files, they show per step, in
 * the order the steps started. No diffs: those open on the desktop. It
 * reads what the run screen follows already (`usePhoneLiveRun`).
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
	const { colors } = useThemeColors();

	const loading =
		groups.length === 0 &&
		(live.connection === "connecting" || run.isPlaceholderData || !run.data);

	if (run.isError && !run.data) {
		return (
			<NativeList onRefresh={refresh}>
				<NativeSection>
					<NativeCustomRow>
						<ErrorAlert
							title="This run did not load"
							message={run.error.message}
							fix="Pull down to try again."
							onRetry={() => void run.refetch()}
						/>
					</NativeCustomRow>
				</NativeSection>
			</NativeList>
		);
	}

	if (loading) {
		return (
			<NativeList onRefresh={refresh}>
				<NativeSection>
					<NativeCustomRow>
						<View className="gap-3 py-2">
							<Skeleton className="h-4 w-1/2" />
							<Skeleton className="h-6 w-1/3" />
						</View>
					</NativeCustomRow>
				</NativeSection>
			</NativeList>
		);
	}

	if (groups.length === 0) {
		return (
			<NativeList onRefresh={refresh}>
				<NativeSection>
					<NativeRow
						icon={{ sf: "doc.on.doc", lucide: Files }}
						iconColor={colors.mutedForeground}
						title="No changed files"
						subtitle="When a step of this run changes files in the project, they show here."
					/>
				</NativeSection>
			</NativeList>
		);
	}

	const single = groups.length === 1;
	return (
		<NativeList onRefresh={refresh}>
			<NativeSection footer="The diff opens on the desktop.">
				<NativeTitleRow
					overline={run.data?.title}
					title={changesSummary(groups)}
				/>
			</NativeSection>
			{groups.map((group) => {
				const step = steps.find((s) => s.id === group.stepId);
				return (
					<StepFiles
						key={group.stepId}
						title={
							single
								? undefined
								: `${step ? stepName(step, labels) : group.stepId} · ${changesSummary([group])}`
						}
						group={group}
					/>
				);
			})}
		</NativeList>
	);
}

/** What shows under the files of a step: files left out, and steps that ran at the same time. */
function stepNotes(group: StepChangedFiles): string | undefined {
	const notes = [
		group.omitted === 1
			? "1 more file changed. The list was too long to show it."
			: group.omitted > 1
				? `${group.omitted} more files changed. The list was too long to show them.`
				: null,
		group.overlapped
			? "Other steps ran at the same time. This list can include their changes."
			: null,
	].filter((note) => note !== null);
	return notes.length > 0 ? notes.join(" ") : undefined;
}

/** The files of one step: under its name and line counts when `title` is given. */
function StepFiles({
	title,
	group,
}: {
	title?: string;
	group: StepChangedFiles;
}) {
	const { colors } = useThemeColors();
	const notes = stepNotes(group);
	if (group.files.length === 0 && !notes) return null;
	return (
		<NativeSection title={title} footer={notes}>
			{group.files.map((file) => (
				<FileRow key={file.path} file={file} color={colors.mutedForeground} />
			))}
		</NativeSection>
	);
}

/** One file: its name, its folder, and "+12 −3". */
function FileRow({ file, color }: { file: ChangedFile; color: string }) {
	const { icon, word } = STATUS[file.status];
	const slash = file.path.lastIndexOf("/");
	const name = file.path.slice(slash + 1);
	const folder = slash > 0 ? file.path.slice(0, slash) : "";
	const lines = file.binary ? null : linesLabel(file.lines);
	const subtitle = [
		folder,
		file.binary ? "Binary file" : "",
		file.oldPath ? `Was ${file.oldPath}` : "",
	]
		.filter((part) => part !== "")
		.join(" · ");
	return (
		<NativeRow
			icon={icon}
			iconColor={color}
			title={name}
			subtitle={subtitle || undefined}
			value={lines ?? undefined}
			accessibilityLabel={[
				`${word} ${name}`,
				folder ? `in ${folder}` : null,
				lines && file.lines
					? `${file.lines.added} lines added, ${file.lines.removed} removed`
					: null,
			]
				.filter((part) => part !== null)
				.join(", ")}
		/>
	);
}
