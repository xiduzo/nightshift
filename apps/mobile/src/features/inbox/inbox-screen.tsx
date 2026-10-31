import { createSpaceQueries, type OpenGate } from "@nightshift/client";
import { Badge } from "@nightshift/ui-native/components/ui/badge";
import { Button } from "@nightshift/ui-native/components/ui/button";
import { Skeleton } from "@nightshift/ui-native/components/ui/skeleton";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { cn } from "@nightshift/ui-native/lib/utils";
import type { ListRenderItemInfo } from "@shopify/flash-list";
import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { ArrowDownUp, Inbox, ListFilter, Search } from "lucide-react-native";
import { memo, useEffect, useMemo, useState } from "react";
import { View } from "react-native";

import { useHostQueries } from "@/features/host";
import { PushCard } from "@/features/push";
import { Chip, ChipRail } from "@/shared/chips";
import { EmptyState } from "@/shared/empty";
import { ErrorAlert } from "@/shared/feedback";
import { HeaderSearch } from "@/shared/header";
import { CellSeparator, ListCell } from "@/shared/list";
import { searchGates } from "@/shared/match";
import { ScreenList } from "@/shared/page";
import { useWhileFocused } from "@/shared/refresh";
import { DigestCard } from "./digest-card";
import { GateRow } from "./gate-row";
import { setInboxView, useInboxView } from "./inbox-filter";
import {
	ALL_GATES,
	headIndices,
	type InboxItem,
	type InboxView,
	inboxGroups,
	inboxItems,
	inboxSummary,
	placeLabel,
	spaceCount,
} from "./inbox-view";
import { useInbox } from "./use-inbox";

/**
 * The Inbox tab: your last morning digest, then the open Gates of every
 * Space you are in, grouped by project, oldest first. Chips choose a project or Space and the order.
 * The search field in the header finds a Gate by a word of its question,
 * flow, run, project or Space. A project's head stays at the top while
 * its Gates scroll under it.
 * `/inbox?project=<id>` opens it on one project.
 */
export function InboxScreen() {
	const inbox = useInbox();
	const view = useInboxView();
	const manySpaces = useManySpaces(inbox.data);
	useProjectParam();
	const [query, setQuery] = useState("");
	const searching = query.trim() !== "";

	const gates = inbox.data;
	const items = useMemo(
		() =>
			gates
				? inboxItems(inboxGroups(searchGates(gates, query), view, manySpaces))
				: [],
		[gates, query, view, manySpaces],
	);
	const heads = useMemo(() => headIndices(items), [items]);
	return (
		<ScreenList
			data={items}
			renderItem={renderItem}
			keyExtractor={itemKey}
			getItemType={itemType}
			ItemSeparatorComponent={CellSeparator}
			stickyHeaderIndices={heads}
			onRefresh={() => inbox.refetch()}
			summary={gates ? inboxSummary(gates) : undefined}
			header={
				<>
					<HeaderSearch placeholder="Your Gates" onChange={setQuery} />
					{searching ? null : <DigestCard />}
					{gates && gates.length > 0 ? (
						<FilterChips gates={gates} view={view} />
					) : null}
					{gates ? (
						gates.length === 0 ? (
							<>
								<EmptyState
									icon={Inbox}
									title="Nothing needs you"
									description="When a run waits for your answer, it shows here. This covers every Space you are in."
								>
									<Button
										size="lg"
										variant="outline"
										onPress={() => router.navigate("/runs")}
										className="h-auto min-h-11 py-2"
									>
										<Text>Go to Runs</Text>
									</Button>
								</EmptyState>
								<PushCard />
							</>
						) : items.length === 0 ? (
							<NoGates gates={gates} query={query} view={view} />
						) : null
					) : inbox.error ? (
						<ErrorAlert
							title="The inbox did not load"
							message="Check that this phone is online. Then pull down or try again."
							onRetry={() => void inbox.refetch()}
						/>
					) : (
						<>
							<Skeleton className="h-11 w-2/3 rounded-full" />
							<Skeleton className="h-24 w-full rounded-xl" />
							<Skeleton className="h-24 w-full rounded-xl" />
						</>
					)}
				</>
			}
		/>
	);
}

type Item = InboxItem<OpenGate>;

function itemKey(item: Item): string {
	return item.key;
}

function itemType(item: Item): Item["kind"] {
	return item.kind;
}

function renderItem({ item }: ListRenderItemInfo<Item>) {
	return item.kind === "head" ? (
		<GroupHead title={item.title} count={item.count} top={item.top} />
	) : (
		<ListCell first={item.first} last={item.last}>
			<GateRow gate={item.gate} />
		</ListCell>
	);
}

/** The head of a project's Gates: its name and how many are open. It sticks to the top. */
const GroupHead = memo(function GroupHead({
	title,
	count,
	top,
}: {
	title: string;
	count: number;
	top: boolean;
}) {
	return (
		<View
			className={cn(
				"flex-row items-center gap-2 bg-background pb-2",
				top ? "pt-0" : "pt-4",
			)}
		>
			<Text
				accessibilityRole="header"
				className="flex-shrink font-semibold text-base"
				numberOfLines={1}
			>
				{title}
			</Text>
			<Badge variant="secondary" accessibilityLabel={`${count} open`}>
				<Text className="tabular-nums">{count}</Text>
			</Badge>
		</View>
	);
});

/** You are in more than one Space: each group names its Space. */
function useManySpaces(gates: readonly OpenGate[] | undefined): boolean {
	const spaceQueries = useHostQueries(createSpaceQueries);
	const spaces = useQuery({ ...spaceQueries.list(), ...useWhileFocused() });
	if (spaces.data) return spaces.data.spaces.length > 1;
	return gates ? spaceCount(gates) > 1 : false;
}

/** `/inbox?project=<id>`, from a project's Gates row: shows that project once. */
function useProjectParam() {
	const { project } = useLocalSearchParams<{ project?: string }>();
	useEffect(() => {
		if (!project) return;
		setInboxView({ place: { kind: "project", projectId: project } });
		router.setParams({ project: undefined });
	}, [project]);
}

function FilterChips({ gates, view }: { gates: OpenGate[]; view: InboxView }) {
	const all = view.place.kind === "all";
	return (
		<ChipRail>
			<Chip
				label="All"
				count={gates.length}
				selected={all}
				onPress={() => setInboxView({ place: ALL_GATES.place })}
			/>
			<Chip
				label={placeLabel(view.place, gates)}
				icon={ListFilter}
				selected={!all}
				onPress={() => router.push("/inbox-filter")}
				role="button"
				accessibilityHint="Opens the list of projects and Spaces"
			/>
			<Chip
				label={view.sort === "oldest" ? "Oldest first" : "Newest first"}
				icon={ArrowDownUp}
				onPress={() =>
					setInboxView({ sort: view.sort === "oldest" ? "newest" : "oldest" })
				}
				role="button"
				accessibilityHint={
					view.sort === "oldest"
						? "Shows the newest Gates first"
						: "Shows the oldest Gates first"
				}
			/>
		</ChipRail>
	);
}

/** No Gate shows: none matches the search, or none waits in this place. */
function NoGates({
	gates,
	query,
	view,
}: {
	gates: OpenGate[];
	query: string;
	view: InboxView;
}) {
	if (query.trim() !== "") {
		return (
			<EmptyState
				icon={Search}
				title="No Gate matches"
				description={`Nothing here matches "${query.trim()}". Try another word from its question, flow or project.`}
			/>
		);
	}
	return (
		<EmptyState
			icon={Inbox}
			title="No Gates here"
			description={`Nothing waits for you in ${placeLabel(view.place, gates)}. ${gates.length === 1 ? "1 Gate waits" : `${gates.length} Gates wait`} elsewhere.`}
		>
			<Button
				size="lg"
				variant="outline"
				onPress={() => setInboxView({ place: ALL_GATES.place })}
				className="h-auto min-h-11 py-2"
			>
				<Text>Show all Gates</Text>
			</Button>
		</EmptyState>
	);
}
