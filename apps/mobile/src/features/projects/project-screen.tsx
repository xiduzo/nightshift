import {
	createFlowQueries,
	createGateQueries,
	createProjectQueries,
	createRunQueries,
	inboxOrder,
	type OpenGate,
	type Project,
	type RunSummary,
} from "@nightshift/client";
import { Button } from "@nightshift/ui-native/components/ui/button";
import { Card, CardContent } from "@nightshift/ui-native/components/ui/card";
import { Icon } from "@nightshift/ui-native/components/ui/icon";
import { Skeleton } from "@nightshift/ui-native/components/ui/skeleton";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { useQuery } from "@tanstack/react-query";
import { Link, Stack } from "expo-router";
import {
	ExternalLink,
	Hand,
	History,
	Plus,
	Workflow,
} from "lucide-react-native";
import type { ReactNode } from "react";
import { Linking, View } from "react-native";

import { useHostQueries } from "@/features/host";
import { InitialsAvatar } from "@/shared/avatar";
import { ErrorAlert } from "@/shared/feedback";
import { HeaderButton, LargeTitleHeader } from "@/shared/header";
import { ListGroup, ListRow, SectionHead } from "@/shared/list";
import { Screen } from "@/shared/page";
import { useScreenRefresh } from "@/shared/refresh";
import { projectLinks } from "./links";
import { clonesText, newestFirst, remoteParts } from "./overview";
import { ProjectGateRow, ProjectRunRow } from "./rows";

/** How many Gates and runs a section shows. "See all" opens the rest. */
const SHOWN = 5;

/**
 * One project: where its code lives, the way to its Gates, runs and
 * flows, the Gates that wait in it (oldest first) and its newest runs.
 */
export function ProjectScreen({ projectId }: { projectId: string }) {
	const projectQueries = useHostQueries(createProjectQueries);
	const gateQueries = useHostQueries(createGateQueries);
	const runQueries = useHostQueries(createRunQueries);
	const flowQueries = useHostQueries(createFlowQueries);
	const projects = useQuery(projectQueries.list());
	const gates = useQuery({
		...gateQueries.open(),
		select: (open: OpenGate[]) =>
			inboxOrder(open.filter((gate) => gate.projectId === projectId)),
	});
	const runs = useQuery({
		...runQueries.ofProjectLive(projectId),
		select: (list: RunSummary[]) => newestFirst(list),
	});
	const flows = useQuery(flowQueries.list(projectId));
	const refresh = useScreenRefresh([
		projects.refetch,
		gates.refetch,
		runs.refetch,
		flows.refetch,
	]);
	const project = projects.data?.find((p) => p.id === projectId);
	// The rows render again on each poll: often enough for "waited 12 min".
	const now = Math.max(runs.dataUpdatedAt, gates.dataUpdatedAt) || Date.now();

	return (
		<Screen onRefresh={refresh}>
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
							value={runs.data ? String(runs.data.length) : undefined}
							href={projectLinks.runs(projectId)}
							dismissTo
							accessibilityHint="Opens Runs with the runs of this project"
						/>
						<ListRow
							icon={Workflow}
							title="Flows"
							caption="How often their runs finish"
							value={flows.data ? String(flows.data.length) : undefined}
							href={projectLinks.flows(projectId)}
							accessibilityHint="Shows how the flows of this project do"
						/>
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
										<ProjectGateRow
											key={`${gate.runId}:${gate.stepId}`}
											gate={gate}
											now={now}
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

					<View className="gap-3">
						<SectionHead
							title="Runs"
							hint={
								runs.data && runs.data.length > 0 ? "Newest first" : undefined
							}
							seeAll={
								runs.data && runs.data.length > SHOWN
									? { href: projectLinks.runs(projectId), dismissTo: true }
									: undefined
							}
						/>
						{runs.data ? (
							runs.data.length > 0 ? (
								<ListGroup>
									{runs.data.slice(0, SHOWN).map((run) => (
										<ProjectRunRow key={run.id} run={run} now={now} />
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

/** Who owns the project, its name, the computers with a copy, its remote and New run. */
function ProjectHeader({ project }: { project: Project }) {
	const remote = remoteParts(project.remote);
	return (
		<View className="gap-1">
			<LargeTitleHeader
				title={project.name}
				summary={clonesText(project.clones) ?? undefined}
				leading={
					remote?.owner ? (
						<>
							<InitialsAvatar name={remote.owner} />
							<Text className="text-muted-foreground text-sm">
								{remote.owner}
							</Text>
						</>
					) : undefined
				}
				actions={
					<HeaderButton
						icon={Plus}
						label="New run"
						hint="Starts one of the flows of this project"
						href={projectLinks.start(project.id)}
					/>
				}
			/>
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
