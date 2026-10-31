import {
	createDashboardQueries,
	createFlowQueries,
	createGateQueries,
	createProjectQueries,
	createRunQueries,
	gateRun,
	type OpenGate,
	type Project,
} from "@nightshift/client";
import { Button } from "@nightshift/ui-native/components/ui/button";
import { Card, CardContent } from "@nightshift/ui-native/components/ui/card";
import { Icon } from "@nightshift/ui-native/components/ui/icon";
import { Skeleton } from "@nightshift/ui-native/components/ui/skeleton";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { useQuery } from "@tanstack/react-query";
import { Link, router, Stack } from "expo-router";
import {
	ExternalLink,
	Hand,
	History,
	Plus,
	Workflow,
} from "lucide-react-native";
import { type ReactNode, useCallback } from "react";
import { Linking, View } from "react-native";

import { offlineAlert, useOfflineNeeds } from "@/features/dashboard";
import { useHostQueries } from "@/features/host";
import { GateRow } from "@/features/inbox";
import { LearningsRow, useWaitingLearnings } from "@/features/learnings";
import { SchedulesRow } from "@/features/schedules";
import { InitialsAvatar } from "@/shared/avatar";
import { ErrorAlert } from "@/shared/feedback";
import { HeaderToolbar } from "@/shared/header";
import { ListGroup, ListRow, SectionHead } from "@/shared/list";
import { Screen } from "@/shared/page";
import { useScreenRefresh, useWhileFocused } from "@/shared/refresh";
import { ConsoleGlance } from "./console-glance";
import { projectLinks } from "./links";
import { clonesText, newestFirst, remoteParts } from "./overview";
import { SHOWN } from "./prefetch";
import { ProjectRunRow } from "./rows";

/**
 * One project: where its code lives, the way to its Gates, runs and
 * flows, the Gates that wait in it (oldest first), how last week went and
 * its newest runs.
 */
export function ProjectScreen({ projectId }: { projectId: string }) {
	const projectQueries = useHostQueries(createProjectQueries);
	const gateQueries = useHostQueries(createGateQueries);
	const runQueries = useHostQueries(createRunQueries);
	const flowQueries = useHostQueries(createFlowQueries);
	const dashboard = useHostQueries(createDashboardQueries);
	const projects = useQuery({ ...projectQueries.list(), ...useWhileFocused() });
	const ofProject = useCallback(
		(open: OpenGate[]) => open.filter((gate) => gate.projectId === projectId),
		[projectId],
	);
	const gates = useQuery({
		...gateQueries.open(),
		select: ofProject,
		...useWhileFocused(),
	});
	// Only the newest: the project list counts them all.
	const runs = useQuery({
		...runQueries.ofProject(projectId, SHOWN),
		select: newestFirst,
		...useWhileFocused(),
	});
	const flows = useQuery({
		...flowQueries.list(projectId),
		...useWhileFocused(),
	});
	// The project's Console numbers: the Flows sheet reads the same.
	const summary = useQuery({
		...dashboard.summary({ projectId }),
		...useWhileFocused(),
	});
	const offline = useOfflineNeeds(projectId);
	const learnings = useWaitingLearnings(projectId);
	const offlineTitle = offline ? offlineAlert(offline)?.title : undefined;
	const refresh = useScreenRefresh([
		projects.refetch,
		gates.refetch,
		runs.refetch,
		flows.refetch,
		summary.refetch,
	]);
	const project = projects.data?.find((p) => p.id === projectId);
	// An older Host sends no counts, and every run whatever the limit.
	const runCount = project?.runs?.total ?? runs.data?.length;

	return (
		<Screen
			onRefresh={refresh}
			summary={project ? (clonesText(project.clones) ?? undefined) : undefined}
		>
			<Stack.Screen options={{ title: project?.name ?? "Project" }} />
			{project ? (
				<>
					<ProjectHeader project={project} />
					<ListGroup>
						<ListRow
							icon={Hand}
							title="Gates"
							value={gates.data ? String(gates.data.length) : undefined}
							valueLabel={gates.data ? `${gates.data.length} open` : undefined}
							href={projectLinks.inbox(projectId)}
							dismissTo
							accessibilityHint="Opens the Inbox with the Gates of this project"
						/>
						<ListRow
							icon={History}
							title="Runs"
							value={runCount !== undefined ? String(runCount) : undefined}
							href={projectLinks.runs(projectId)}
							dismissTo
							accessibilityHint="Opens Runs with the runs of this project"
						/>
						<ListRow
							icon={Workflow}
							title="Flows"
							caption={
								offlineTitle
									? [{ text: offlineTitle, tone: "failed" }]
									: "How often their runs finish"
							}
							value={flows.data ? String(flows.data.length) : undefined}
							href={projectLinks.flows(projectId)}
							accessibilityHint="Shows how the flows of this project do"
						/>
						<SchedulesRow projectId={projectId} />
						{learnings !== undefined ? (
							<LearningsRow projectId={projectId} count={learnings} />
						) : null}
					</ListGroup>

					<View className="gap-3">
						<SectionHead
							title="Needs you"
							hint={
								gates.data && gates.data.length > 0 ? "Oldest first" : undefined
							}
							seeAll={
								gates.data && gates.data.length > SHOWN
									? { href: projectLinks.inbox(projectId), dismissTo: true }
									: undefined
							}
						/>
						{gates.data ? (
							gates.data.length > 0 ? (
								<ListGroup>
									{gates.data.slice(0, SHOWN).map((gate) => (
										<GateRow
											key={`${gate.runId}:${gate.stepId}`}
											gate={gate}
											overline={gateOverline(gate)}
										/>
									))}
								</ListGroup>
							) : (
								<Line text="Nothing waits for an answer in this project." />
							)
						) : gates.isError ? (
							<ErrorAlert
								title="The Gates did not load"
								message={gates.error.message}
								fix="Check that this phone is online, then try again."
								onRetry={() => void gates.refetch()}
							/>
						) : (
							<Skeleton className="h-20 w-full rounded-xl" />
						)}
					</View>

					<ConsoleGlance summary={summary.data} failed={summary.isError} />

					<View className="gap-3">
						<SectionHead
							title="Runs"
							hint={
								runs.data && runs.data.length > 0 ? "Newest first" : undefined
							}
							seeAll={
								runCount !== undefined && runCount > SHOWN
									? { href: projectLinks.runs(projectId), dismissTo: true }
									: undefined
							}
						/>
						{runs.data ? (
							runs.data.length > 0 ? (
								<ListGroup>
									{runs.data.slice(0, SHOWN).map((run) => (
										<ProjectRunRow key={run.id} run={run} />
									))}
								</ListGroup>
							) : (
								<Line text="No runs yet. Start one of its flows with New run.">
									<Link href={projectLinks.start(projectId)} asChild>
										<Button
											size="lg"
											variant="outline"
											className="h-auto min-h-11 self-start py-2"
										>
											<Icon as={Plus} />
											<Text>New run</Text>
										</Button>
									</Link>
								</Line>
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
				</>
			) : projects.data ? (
				<ErrorAlert
					title="This project is not in this Space"
					message="It may belong to another Space."
					fix="Choose that Space on the Projects tab."
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

/**
 * Who owns the project and its remote. The native header holds its name
 * and New run.
 */
function ProjectHeader({ project }: { project: Project }) {
	const remote = remoteParts(project.remote);
	return (
		<View className="gap-1">
			<HeaderToolbar
				placement="right"
				items={[
					{
						kind: "button",
						key: "start",
						label: "New run",
						hint: "Starts one of the flows of this project",
						sf: "plus",
						icon: Plus,
						onPress: () => router.push(projectLinks.start(project.id)),
					},
				]}
			/>
			{remote?.owner ? (
				<View className="flex-row items-center gap-2">
					<InitialsAvatar name={remote.owner} />
					<Text className="text-muted-foreground text-sm">{remote.owner}</Text>
				</View>
			) : null}
			{remote && project.remote ? (
				<Button
					size="lg"
					variant="ghost"
					className="-ml-3 h-auto min-h-11 self-start py-2"
					onPress={() => void Linking.openURL(remote.url)}
					accessibilityRole="link"
					accessibilityLabel={`Open ${project.remote} in the browser`}
				>
					<Text className="font-mono text-muted-foreground text-sm">
						{project.remote}
					</Text>
					<Icon as={ExternalLink} className="size-4 text-muted-foreground" />
				</Button>
			) : null}
		</View>
	);
}

/** The overline of a Gate on its project's page: its flow and run, not the project again. */
function gateOverline(gate: OpenGate): string {
	const { flow, detail } = gateRun(gate);
	return detail ? `${flow} · ${detail}` : flow;
}

/** A section with nothing in it: one muted line in a Card, and what to do. */
function Line({ text, children }: { text: string; children?: ReactNode }) {
	return (
		<Card className="py-4">
			<CardContent className="gap-3 px-4">
				<Text className="text-muted-foreground text-sm">{text}</Text>
				{children}
			</CardContent>
		</Card>
	);
}
