import {
	createProjectQueries,
	hoverTime,
	type RunSummary,
} from "@nightshift/client";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui-native/components/ui/alert";
import { Badge } from "@nightshift/ui-native/components/ui/badge";
import { Button } from "@nightshift/ui-native/components/ui/button";
import { Skeleton } from "@nightshift/ui-native/components/ui/skeleton";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { cn } from "@nightshift/ui-native/lib/utils";
import type { ListRenderItemInfo } from "@shopify/flash-list";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Inbox, Undo2 } from "lucide-react-native";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";

import { useHostQueries, useSignedIn } from "@/features/host";
import { GateRow } from "@/features/inbox";
import { type Learning, LearningRow } from "@/features/learnings";
import { PushCard } from "@/features/push";
import { leaveRun, unleaveRun } from "@/features/runs";
import { EmptyState } from "@/shared/empty";
import { ErrorAlert } from "@/shared/feedback";
import { formatTime } from "@/shared/format";
import { TabRootHeader } from "@/shared/header";
import { CellSeparator, ListCell } from "@/shared/list";
import { ScreenList } from "@/shared/page";
import { useScreenRefresh, useWhileFocused } from "@/shared/refresh";
import {
	headIndices,
	type NeedsRow,
	type NeedsSection,
	needsRows,
	needsSummary,
} from "./queue";
import { retryState } from "./retry";
import { StoppedRunRow } from "./stopped-run-row";
import { useNeedsYou } from "./use-needs";
import { useRetryRuns } from "./use-retry";

/** How long Undo stays after you leave a run. */
const UNDO_MS = 10_000;

/** The head of each section: its title and what you do with it. */
const SECTION_HEAD: Record<NeedsSection, { title: string; hint: string }> = {
	gate: {
		title: "Gates",
		hint: "Answer before the deadline. Then Night Shift picks for you.",
	},
	run: {
		title: "Runs that stopped",
		hint: "Retry or resume them, or leave them.",
	},
	learning: {
		title: "Learnings to check",
		hint: "Agents use a learning you keep from their next run.",
	},
};

type Row = NeedsRow<Learning>;

/**
 * The Needs you tab: everything that waits for you, in three sections.
 * The Gates you may answer, the first to close first. The runs that
 * stopped in the last day, with Retry or Resume and Leave it. The
 * learnings to keep or delete. A section's head stays at the top while
 * its rows scroll under it.
 */
export function NeedsScreen() {
	const { person } = useSignedIn();
	const { subscribed } = useWhileFocused();
	const needs = useNeedsYou(subscribed);
	const projectQueries = useHostQueries(createProjectQueries);
	const projects = useQuery({ ...projectQueries.list(), subscribed });
	const refresh = useScreenRefresh([needs.refetch, projects.refetch]);
	const retry = useRetryRuns();
	const { onKeep, onDelete, failure: settleFailure } = needs.learnings;
	const [left, setLeft] = useState<{ runId: string; title: string } | null>(
		null,
	);

	useEffect(() => {
		if (!left) return;
		const timer = setTimeout(() => setLeft(null), UNDO_MS);
		return () => clearTimeout(timer);
	}, [left]);

	const onLeave = useCallback((run: RunSummary) => {
		leaveRun(run.id);
		setLeft({ runId: run.id, title: run.title });
	}, []);

	const projectNames = useMemo(
		() => new Map((projects.data ?? []).map((p) => [p.id, p.name])),
		[projects.data],
	);
	const rows = useMemo(() => needsRows(needs.items), [needs.items]);
	const heads = useMemo(() => headIndices(rows), [rows]);
	const { sends, onRetry } = retry;

	const renderItem = useCallback(
		({ item }: ListRenderItemInfo<Row>) => {
			switch (item.kind) {
				case "head":
					return (
						<SectionHeadRow
							section={item.section}
							count={item.count}
							top={item.top}
						/>
					);
				case "gate":
					return (
						<ListCell first={item.first} last={item.last}>
							<GateRow gate={item.gate} />
						</ListCell>
					);
				case "run":
					return (
						<ListCell first={item.first} last={item.last}>
							<StoppedRunRow
								run={item.run}
								projectName={projectNames.get(item.run.projectId) ?? null}
								retry={retryState(item.run, sends)}
								onRetry={onRetry}
								onLeave={onLeave}
							/>
						</ListCell>
					);
				case "learning":
					return (
						<ListCell first={item.first} last={item.last}>
							<LearningRow
								learning={item.learning}
								projectName={projectNames.get(item.learning.projectId) ?? null}
								onKeep={onKeep}
								onDelete={onDelete}
							/>
						</ListCell>
					);
			}
		},
		[projectNames, sends, onRetry, onLeave, onKeep, onDelete],
	);

	const firstGate = needs.items.find((item) => item.kind === "gate");
	const firstDeadline =
		firstGate?.kind === "gate" ? firstGate.gate.deadline?.at : undefined;

	const empty =
		!needs.loading &&
		needs.items.length === 0 &&
		!needs.gatesError &&
		!needs.runsError;

	return (
		<ScreenList
			data={rows}
			renderItem={renderItem}
			extraData={renderItem}
			keyExtractor={rowKey}
			getItemType={rowType}
			ItemSeparatorComponent={CellSeparator}
			stickyHeaderIndices={heads}
			onRefresh={refresh}
			summary={
				needs.items.length > 0
					? needsSummary(needs.items, formatTime)
					: undefined
			}
			summaryHint={
				firstDeadline === undefined ? undefined : hoverTime(firstDeadline)
			}
			header={
				<>
					<TabRootHeader name={person.name} />
					{left ? (
						<Alert icon={Undo2}>
							<AlertTitle>You left {left.title}</AlertTitle>
							<AlertDescription>It stays in Runs.</AlertDescription>
							<Button
								variant="outline"
								size="sm"
								className="mt-2 h-auto min-h-11 self-start py-2"
								onPress={() => {
									unleaveRun(left.runId);
									setLeft(null);
								}}
								accessibilityHint="Puts the run back on this list"
							>
								<Text>Undo</Text>
							</Button>
						</Alert>
					) : null}
					{needs.gatesError ? (
						<ErrorAlert
							title="Your Gates did not load"
							message={needs.gatesError.message}
							fix="Check that this phone is online. Then pull down or try again."
							onRetry={() => void needs.refetch()}
						/>
					) : null}
					{needs.runsError ? (
						<ErrorAlert
							title="The runs that stopped did not load"
							message={needs.runsError.message}
							fix="Check that this phone is online. Then pull down or try again."
							onRetry={() => void needs.refetch()}
						/>
					) : null}
					{retry.failure ? (
						<ErrorAlert
							title={retry.failure.title}
							message={retry.failure.message}
							fix="Check that this phone is online and that your role in this Space lets you do this."
						/>
					) : null}
					{settleFailure ? (
						<ErrorAlert
							title={settleFailure.title}
							message={settleFailure.message}
							fix="Check that this phone is online, then try again."
						/>
					) : null}
					{needs.loading ? (
						<>
							<Skeleton className="h-6 w-1/3 rounded-md" />
							<Skeleton className="h-24 w-full rounded-xl" />
							<Skeleton className="h-24 w-full rounded-xl" />
						</>
					) : empty ? (
						<>
							<EmptyState
								icon={Inbox}
								title="Nothing needs you"
								description="When a Gate opens, a run stops or agents learn something, it shows here."
							>
								<Button
									size="lg"
									variant="outline"
									onPress={() => router.navigate("/")}
									className="h-auto min-h-11 py-2"
								>
									<Text>See last night</Text>
								</Button>
							</EmptyState>
							<PushCard />
						</>
					) : null}
				</>
			}
		/>
	);
}

function rowKey(row: Row): string {
	return row.key;
}

function rowType(row: Row): Row["kind"] {
	return row.kind;
}

/** The head of a section: its title, how many wait, and what to do. It sticks to the top. */
const SectionHeadRow = memo(function SectionHeadRow({
	section,
	count,
	top,
}: {
	section: NeedsSection;
	count: number;
	top: boolean;
}) {
	const { title, hint } = SECTION_HEAD[section];
	return (
		<View className={cn("gap-0.5 bg-background pb-2", top ? "pt-0" : "pt-6")}>
			<View className="flex-row items-center gap-2">
				<Text
					accessibilityRole="header"
					className="flex-shrink font-semibold text-xl tracking-tight"
					numberOfLines={1}
				>
					{title}
				</Text>
				<Badge variant="secondary" accessibilityLabel={`${count} waiting`}>
					<Text className="tabular-nums">{count}</Text>
				</Badge>
			</View>
			<Text className="text-muted-foreground text-sm">{hint}</Text>
		</View>
	);
});
