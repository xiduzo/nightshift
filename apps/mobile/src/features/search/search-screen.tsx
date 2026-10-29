import {
	createGateQueries,
	createProjectQueries,
	createRunQueries,
	type RunSummary,
	whenLabel,
} from "@nightshift/client";
import { Input } from "@nightshift/ui-native/components/ui/input";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react-native";
import { useMemo, useState } from "react";
import { View } from "react-native";
import { useHostQueries } from "@/features/host";
import { GateRow } from "@/features/inbox";
import { EmptyState } from "@/shared/empty";
import { LargeTitleHeader } from "@/shared/header";
import { ListGroup, ListRow, SectionHead } from "@/shared/list";
import { Screen } from "@/shared/page";
import { runStatusLook } from "@/shared/tone";
import { resultsText, searchGates, searchRuns } from "./search";

/**
 * Search the Gates and runs this phone has: the open Gates of every Space
 * you are in, and the runs of the Space you work in. A sheet from the
 * headers of Home, Inbox and Runs.
 */
export function SearchScreen() {
	const [query, setQuery] = useState("");
	const gateQueries = useHostQueries(createGateQueries);
	const runQueries = useHostQueries(createRunQueries);
	const projectQueries = useHostQueries(createProjectQueries);
	const gates = useQuery(gateQueries.open());
	const runs = useQuery(runQueries.everyRun());
	const projects = useQuery(projectQueries.list());

	const names = useMemo(
		() =>
			new Map(
				(projects.data ?? []).map((project) => [project.id, project.name]),
			),
		[projects.data],
	);
	const foundGates = gates.data ? searchGates(gates.data, query) : [];
	const foundRuns = runs.data
		? searchRuns(runs.data, query, (id) => names.get(id))
		: [];
	const loaded = gates.data !== undefined || runs.data !== undefined;
	const now = Date.now();

	return (
		<Screen>
			<LargeTitleHeader compact title="Search" />
			<Input
				value={query}
				onChangeText={setQuery}
				placeholder="A question, a flow, a project or a branch"
				accessibilityLabel="Search Gates and runs"
				autoFocus
				autoCorrect={false}
				autoCapitalize="none"
				returnKeyType="search"
				clearButtonMode="while-editing"
			/>
			{loaded ? (
				<Text
					className="text-muted-foreground text-sm"
					accessibilityLiveRegion="polite"
				>
					{resultsText(query, foundGates.length, foundRuns.length)}
				</Text>
			) : null}
			{foundGates.length > 0 ? (
				<View className="gap-3">
					<SectionHead title="Gates" hint="Oldest first" />
					<ListGroup>
						{foundGates.map((gate) => (
							<GateRow
								key={`${gate.runId}:${gate.stepId}`}
								gate={gate}
								now={now}
							/>
						))}
					</ListGroup>
				</View>
			) : null}
			{foundRuns.length > 0 ? (
				<View className="gap-3">
					<SectionHead title="Runs" hint="Newest first" />
					<ListGroup>
						{foundRuns.map((run) => (
							<RunResult
								key={run.id}
								run={run}
								projectName={names.get(run.projectId)}
								now={now}
							/>
						))}
					</ListGroup>
				</View>
			) : null}
			{!loaded ? (
				<EmptyState
					icon={Search}
					title="Find a Gate or a run"
					description="Type a word from its question, its flow, its project or its branch."
				/>
			) : null}
		</Screen>
	);
}

/** A run that matches: its status, title, project and branch, and when it started. */
function RunResult({
	run,
	projectName,
	now,
}: {
	run: RunSummary;
	projectName: string | undefined;
	now: number;
}) {
	const look = runStatusLook(run.status);
	const started = whenLabel(run.createdAt, now);
	return (
		<ListRow
			look={look}
			title={run.title}
			caption={[
				{ text: look.label, tone: look.tone },
				projectName ?? "",
				{ text: run.branch, mono: true },
			]}
			value={started}
			valueLabel={`started ${started}`}
			href={{ pathname: "/runs/[runId]", params: { runId: run.id } }}
			accessibilityHint="Opens the run"
		/>
	);
}
