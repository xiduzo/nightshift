import {
	createDashboardQueries,
	createProjectQueries,
	createRunQueries,
	gateRun,
	type OpenGate,
	type Project,
	type RunSummary,
} from "@nightshift/client";
import { Button } from "@nightshift/ui-native/components/ui/button";
import { Icon } from "@nightshift/ui-native/components/ui/icon";
import { Skeleton } from "@nightshift/ui-native/components/ui/skeleton";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { useQuery } from "@tanstack/react-query";
import { type Href, router, Stack } from "expo-router";
import {
	CircleCheck,
	ExternalLink,
	Lightbulb,
	Plus,
} from "lucide-react-native";
import { type ReactNode, useCallback, useMemo } from "react";
import { Linking, View } from "react-native";

import { useHostQueries } from "@/features/host";
import { GateRow, useInbox } from "@/features/inbox";
import { useWaitingLearnings } from "@/features/learnings";
import { RunRow, useStoppedRuns } from "@/features/runs";
import { ErrorAlert } from "@/shared/feedback";
import { HeaderToolbar } from "@/shared/header";
import { ListGroup, ListRow, SectionHead } from "@/shared/list";
import { Screen } from "@/shared/page";
import { useScreenRefresh, useWhileFocused } from "@/shared/refresh";
import { NightsGlance } from "./nights-glance";
import { remoteUrl } from "./remote";

/** How many runs the page shows. "All runs" opens the rest. */
const SHOWN = 5;

function startHref(projectId: string): Href {
	return { pathname: "/start", params: { projectId } };
}

function newestFirst(runs: RunSummary[]): RunSummary[] {
	return [...runs].sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * One project, at a glance: what needs you in it, how its last 7 nights
 * went and its newest runs. New run starts a run in it.
 */
export function ProjectScreen({ projectId }: { projectId: string }) {
	const projectQueries = useHostQueries(createProjectQueries);
	const runQueries = useHostQueries(createRunQueries);
	const dashboard = useHostQueries(createDashboardQueries);
	const focused = useWhileFocused();
	const projects = useQuery({ ...projectQueries.list(), ...focused });
	const runs = useQuery({
		...runQueries.ofProject(projectId, SHOWN),
		select: newestFirst,
		...focused,
	});
	const summary = useQuery({
		...dashboard.summary({ projectId }),
		...focused,
	});
	const refresh = useScreenRefresh([
		projects.refetch,
		runs.refetch,
		summary.refetch,
	]);
	const project = projects.data?.find((p) => p.id === projectId);

	return (
		<Screen onRefresh={refresh}>
			<Stack.Screen options={{ title: project?.name ?? "Project" }} />
			{project ? (
				<>
					<ProjectHeader project={project} />
					<NeedsYou projectId={projectId} />
					<NightsGlance summary={summary.data} failed={summary.isError} />
					<View className="gap-3">
						<SectionHead
							title="Runs"
							seeAll={{
								href: { pathname: "/runs", params: { project: projectId } },
								dismissTo: true,
								label: "All runs",
							}}
						/>
						{runs.data ? (
							runs.data.length > 0 ? (
								<ListGroup>
									{runs.data.slice(0, SHOWN).map((run) => (
										<RunRow key={run.id} run={run} projectName={null} />
									))}
								</ListGroup>
							) : (
								<ListGroup>
									<ListRow
										icon={CircleCheck}
										title="No runs yet"
										caption="Start one with New run."
									/>
								</ListGroup>
							)
						) : runs.isError ? (
							<ErrorAlert
								title="The runs did not load"
								message={runs.error.message}
								fix="Check that this phone is online, then try again."
								onRetry={() => void runs.refetch()}
							/>
						) : (
							<Skeleton className="h-20 w-full rounded-xl" />
						)}
					</View>
					<Button
						size="lg"
						variant="outline"
						className="h-auto min-h-11 py-2"
						onPress={() => router.push(startHref(projectId))}
					>
						<Icon as={Plus} />
						<Text>New run in {project.name}</Text>
					</Button>
				</>
			) : projects.data ? (
				<ErrorAlert
					title="This project is not in this Space"
					message="It may belong to another Space."
					fix="Choose that Space on the Runs tab."
				/>
			) : projects.isError ? (
				<ErrorAlert
					title="This project did not load"
					message={projects.error.message}
					fix="Check that this phone is online, then try again."
					onRetry={() => void projects.refetch()}
				/>
			) : (
				<Skeleton className="h-40 w-full rounded-xl" />
			)}
		</Screen>
	);
}

/** New run in the native header, and the project's remote under its name. */
function ProjectHeader({ project }: { project: Project }) {
	const url = remoteUrl(project.remote);
	return (
		<>
			<HeaderToolbar
				placement="right"
				items={[
					{
						kind: "button",
						key: "start",
						label: "New run",
						hint: "Starts a run in this project",
						sf: "plus",
						icon: Plus,
						onPress: () => router.push(startHref(project.id)),
					},
				]}
			/>
			{url && project.remote ? (
				<Button
					size="lg"
					variant="ghost"
					className="-mt-2 -ml-3 h-auto min-h-11 self-start py-2"
					onPress={() => void Linking.openURL(url)}
					accessibilityRole="link"
					accessibilityLabel={`Open ${project.remote} in the browser`}
				>
					<Text className="font-mono text-muted-foreground text-sm">
						{project.remote}
					</Text>
					<Icon as={ExternalLink} className="size-4 text-muted-foreground" />
				</Button>
			) : null}
		</>
	);
}

/**
 * What waits for you in the project: its open Gates, the runs that
 * stopped last night, and the learnings to check. Each row opens where
 * you act on it.
 */
function NeedsYou({ projectId }: { projectId: string }) {
	const { subscribed } = useWhileFocused();
	const inbox = useInbox(subscribed);
	const stopped = useStoppedRuns(subscribed);
	const learnings = useWaitingLearnings(projectId);
	const ofProject = useCallback(
		<T extends { projectId: string }>(list: readonly T[] | undefined) =>
			list?.filter((item) => item.projectId === projectId),
		[projectId],
	);
	const gates = useMemo(() => ofProject(inbox.data), [ofProject, inbox.data]);
	const runs = useMemo(
		() => ofProject(stopped.runs),
		[ofProject, stopped.runs],
	);

	let body: ReactNode;
	if (gates === undefined) {
		body = inbox.isError ? (
			<ErrorAlert
				title="The Gates did not load"
				message={inbox.error.message}
				fix="Check that this phone is online, then try again."
				onRetry={() => void inbox.refetch()}
			/>
		) : (
			<Skeleton className="h-20 w-full rounded-xl" />
		);
	} else {
		const waiting = learnings ?? 0;
		const empty =
			gates.length === 0 && (runs ?? []).length === 0 && waiting === 0;
		body = (
			<ListGroup>
				{gates.map((gate) => (
					<GateRow
						key={`${gate.runId}:${gate.stepId}`}
						gate={gate}
						overline={gateOverline(gate)}
					/>
				))}
				{(runs ?? []).map((run) => (
					<RunRow key={run.id} run={run} projectName={null} />
				))}
				{waiting > 0 ? (
					<ListRow
						icon={Lightbulb}
						tone="needs-input"
						title={
							waiting === 1
								? "1 learning waits for you"
								: `${waiting} learnings wait for you`
						}
						href="/needs"
						dismissTo
						accessibilityHint="Opens Needs you, to keep or delete them"
					/>
				) : null}
				{empty ? (
					<ListRow
						icon={CircleCheck}
						tone="finished"
						title="Nothing needs you here"
					/>
				) : null}
			</ListGroup>
		);
	}
	return (
		<View className="gap-3">
			<SectionHead title="Needs you" />
			{body}
		</View>
	);
}

/** The overline of a Gate on its project's page: its flow and run, not the project again. */
function gateOverline(gate: OpenGate): string {
	const { flow, detail } = gateRun(gate);
	return detail ? `${flow} · ${detail}` : flow;
}
