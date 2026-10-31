import {
	createGateQueries,
	createProjectQueries,
	createRunQueries,
	type RunSummary,
	whenLabel,
} from "@nightshift/client";
import { Skeleton } from "@nightshift/ui-native/components/ui/skeleton";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { View } from "react-native";
import { useHostQueries } from "@/features/host";
import { GateRow } from "@/features/inbox";
import { ListGroup, ListRow, SectionHead } from "@/shared/list";
import { searchGates } from "@/shared/match";
import { useWhileFocused } from "@/shared/refresh";
import { runStatusLook } from "@/shared/tone";
import { resultsText, searchRuns } from "./search";

/**
 * What the search field in the header of Home and Runs finds: the open
 * Gates of every Space you are in, and the runs of the Space you work
 * in, from what this phone has. The screen shows it in place of its body
 * while the field holds a query.
 */
export function SearchResults({ query }: { query: string }) {
	const gateQueries = useHostQueries(createGateQueries);
	const runQueries = useHostQueries(createRunQueries);
	const projectQueries = useHostQueries(createProjectQueries);
	const gates = useQuery({ ...gateQueries.open(), ...useWhileFocused() });
	const runs = useQuery({ ...runQueries.everyRun(), ...useWhileFocused() });
	const projects = useQuery({ ...projectQueries.list(), ...useWhileFocused() });

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

	if (!loaded) return <Skeleton className="h-40 w-full rounded-xl" />;
	return (
		<>
			<Text
				className="text-muted-foreground text-sm"
				accessibilityLiveRegion="polite"
			>
				{resultsText(query, foundGates.length, foundRuns.length)}
			</Text>
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
		</>
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
