import { createSpaceQueries, type OpenGate } from "@nightshift/client";
import { Badge } from "@nightshift/ui-native/components/ui/badge";
import { Button } from "@nightshift/ui-native/components/ui/button";
import { Skeleton } from "@nightshift/ui-native/components/ui/skeleton";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { ArrowDownUp, Inbox, ListFilter, Search } from "lucide-react-native";
import { useEffect, useState } from "react";
import { View } from "react-native";

import { useHostQueries } from "@/features/host";
import { PushCard } from "@/features/push";
import { Chip, ChipRail } from "@/shared/chips";
import { EmptyState } from "@/shared/empty";
import { ErrorAlert } from "@/shared/feedback";
import { useNow } from "@/shared/format";
import { HeaderSearch } from "@/shared/header";
import { ListGroup } from "@/shared/list";
import { searchGates } from "@/shared/match";
import { Screen } from "@/shared/page";
import { useWhileFocused } from "@/shared/refresh";
import { DigestCard } from "./digest-card";
import { GateRow } from "./gate-row";
import { setInboxView, useInboxView } from "./inbox-filter";
import {
	ALL_GATES,
	type InboxView,
	inboxGroups,
	inboxSummary,
	placeLabel,
	spaceCount,
} from "./inbox-view";
import { useInbox } from "./use-inbox";

/**
 * The Inbox tab: your last morning digest, then the open Gates of every
 * Space you are in, grouped by project, oldest first. Chips choose a project or Space and the order.
 * The search field in the header finds a Gate by a word of its question,
 * flow, run, project or Space.
 * `/inbox?project=<id>` opens it on one project.
 */
export function InboxScreen() {
	const inbox = useInbox();
	const view = useInboxView();
	const now = useNow();
	const manySpaces = useManySpaces(inbox.data);
	useProjectParam();
	const [query, setQuery] = useState("");
	const searching = query.trim() !== "";

	const gates = inbox.data;
	return (
		<Screen
			onRefresh={() => inbox.refetch()}
			summary={gates ? inboxSummary(gates) : undefined}
		>
			<HeaderSearch placeholder="Your Gates" onChange={setQuery} />
			{searching ? null : <DigestCard now={now} />}
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
				) : (
					<GateGroups
						gates={gates}
						query={query}
						view={view}
						manySpaces={manySpaces}
						now={now}
					/>
				)
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
		</Screen>
	);
}

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

function GateGroups({
	gates,
	query,
	view,
	manySpaces,
	now,
}: {
	gates: OpenGate[];
	/** What the search field holds: only the Gates that match show. */
	query: string;
	view: InboxView;
	manySpaces: boolean;
	now: number;
}) {
	const groups = inboxGroups(searchGates(gates, query), view, manySpaces);
	if (groups.length === 0 && query.trim() !== "") {
		return (
			<EmptyState
				icon={Search}
				title="No Gate matches"
				description={`Nothing here matches "${query.trim()}". Try another word from its question, flow or project.`}
			/>
		);
	}
	if (groups.length === 0) {
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
	return groups.map((group) => (
		<View key={group.key} className="gap-2">
			<View className="flex-row items-center gap-2">
				<Text
					accessibilityRole="header"
					className="flex-shrink font-semibold text-base"
					numberOfLines={1}
				>
					{group.title}
				</Text>
				<Badge
					variant="secondary"
					accessibilityLabel={`${group.gates.length} open`}
				>
					<Text className="tabular-nums">{group.gates.length}</Text>
				</Badge>
			</View>
			<ListGroup>
				{group.gates.map((gate) => (
					<GateRow key={`${gate.runId}:${gate.stepId}`} gate={gate} now={now} />
				))}
			</ListGroup>
		</View>
	));
}
