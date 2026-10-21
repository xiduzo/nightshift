import {
	costLabel,
	createGateQueries,
	createProjectQueries,
	createRunQueries,
	currentStep,
	flowLabel,
	hasEnded,
	markdownPreview,
	mergeSteps,
	nodeLabels,
	type OpenGate,
	type RunDetail,
	type RunStatus,
	type StepSummary,
	stepName,
	stepState,
	whenLabel,
} from "@nightshift/client";
import { Button } from "@nightshift/ui-native/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@nightshift/ui-native/components/ui/card";
import { Separator } from "@nightshift/ui-native/components/ui/separator";
import { Skeleton } from "@nightshift/ui-native/components/ui/skeleton";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type Href, Redirect, router, Stack } from "expo-router";
import { Fragment, useCallback } from "react";
import { View } from "react-native";

import { FollowOnLockScreen } from "@/features/glance";
import { useHost, useHostQueries } from "@/features/host";
import { ErrorAlert } from "@/shared/feedback";
import { Screen } from "@/shared/page";
import { RunActions } from "./run-actions";
import { titleDetail } from "./run-row";
import { RunStatusBadge, StepStateBadge } from "./status-badge";
import { type LiveRun, useLiveRun } from "./use-live-run";

/**
 * One run, live: its status, its steps, what the agent of the running step
 * says now, the Gates that wait for an answer, and Stop or Resume. Opened
 * from the Runs tab, after a start, or from a notification.
 */
export function RunScreen({ runId }: { runId: string }) {
	const { state } = useHost();
	if (state.status === "loading") return null;
	if (state.status === "signed-out") return <Redirect href="/connect" />;
	return <SignedInRun runId={runId} />;
}

function SignedInRun({ runId }: { runId: string }) {
	const runQueries = useHostQueries(createRunQueries);
	const gateQueries = useHostQueries(createGateQueries);
	const projectQueries = useHostQueries(createProjectQueries);
	const queryClient = useQueryClient();
	const run = useQuery(runQueries.get(runId));
	const gates = useQuery(gateQueries.open());
	const projects = useQuery(projectQueries.list());
	const live = useLiveRun(runId);

	const refresh = useCallback(
		() =>
			Promise.all([
				queryClient.invalidateQueries({ queryKey: runQueries.all() }),
				queryClient.invalidateQueries({ queryKey: gateQueries.all() }),
			]),
		[queryClient, runQueries, gateQueries],
	);

	const title = run.data ? flowLabel(run.data) : "Run";

	return (
		<Screen onRefresh={refresh}>
			<Stack.Screen options={{ title }} />
			{run.data ? (
				<RunBody
					run={run.data}
					live={live}
					gates={(gates.data ?? []).filter((gate) => gate.runId === runId)}
					projectName={
						projects.data?.find((p) => p.id === run.data.projectId)?.name ??
						null
					}
				/>
			) : run.isError ? (
				<ErrorAlert
					title="This run did not load"
					message={run.error.message}
					fix="If the run belongs to another Space, choose that Space on the Runs tab. Or pull down to try again."
					onRetry={() => void run.refetch()}
				/>
			) : (
				<>
					<Skeleton className="h-32 w-full rounded-xl" />
					<Skeleton className="h-24 w-full rounded-xl" />
					<Skeleton className="h-48 w-full rounded-xl" />
				</>
			)}
		</Screen>
	);
}

function RunBody({
	run,
	live,
	gates,
	projectName,
}: {
	run: RunDetail;
	live: LiveRun;
	gates: OpenGate[];
	projectName: string | null;
}) {
	const status: RunStatus = live.status ?? run.status;
	const steps = mergeSteps(run.steps, live.steps);
	const labels = nodeLabels(run);
	const current = hasEnded(status) ? null : currentStep(steps);
	const message = current ? live.messages.get(current.id) : undefined;
	const cost = costLabel(run);
	const facts = [projectName, startedLabel(run.createdAt), cost]
		.filter((fact): fact is string => fact !== null)
		.join(" · ");

	return (
		<>
			<Card>
				<CardHeader className="gap-3">
					<View className="flex-row flex-wrap items-center gap-2">
						<RunStatusBadge status={status} />
						{live.connection === "reconnecting" && !hasEnded(status) ? (
							<Text variant="muted" className="text-muted-foreground">
								Reconnecting…
							</Text>
						) : null}
					</View>
					<CardTitle>{titleDetail(run) ?? flowLabel(run)}</CardTitle>
					<CardDescription>{facts}</CardDescription>
					{hasEnded(status) && run.reason ? (
						<Text variant="muted" className="text-muted-foreground">
							{run.reason}
						</Text>
					) : null}
				</CardHeader>
				<RunActions runId={run.id} status={status} />
				<FollowOnLockScreen runId={run.id} ended={hasEnded(status)} />
			</Card>

			{gates.length > 0 ? <GatesCard gates={gates} /> : null}

			{current &&
			(message || current.nodeType === "agent") &&
			stepState(current) === "running" ? (
				<Card>
					<CardHeader>
						<CardDescription>Now</CardDescription>
						<CardTitle>{stepName(current, labels)}</CardTitle>
					</CardHeader>
					<CardContent>
						<Text
							numberOfLines={8}
							className={message ? undefined : "text-muted-foreground"}
						>
							{message
								? markdownPreview(message.text)
								: "No message from this step yet."}
						</Text>
					</CardContent>
				</Card>
			) : null}

			<StepsCard
				steps={steps.filter((step) => step.scope === null)}
				labels={labels}
			/>
		</>
	);
}

/** "Started just now", "Started today 09:41", "Started 3 Oct 14:20". */
function startedLabel(at: number): string {
	const when = whenLabel(at);
	return `Started ${when.charAt(0).toLowerCase()}${when.slice(1)}`;
}

/** The inbox's answer sheet of one Gate. */
function answerHref(gate: Pick<OpenGate, "runId" | "stepId">): Href {
	return {
		pathname: "/gates/[runId]/[stepId]",
		params: { runId: gate.runId, stepId: gate.stepId },
	};
}

/** The Gates of this run that wait for a person, each with a button to answer it. */
function GatesCard({ gates }: { gates: OpenGate[] }) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Waiting for an answer</CardTitle>
				<CardDescription>The run goes on when someone answers.</CardDescription>
			</CardHeader>
			<CardContent className="gap-4">
				{gates.map((gate, index) => (
					<Fragment key={gate.stepId}>
						{index > 0 ? <Separator /> : null}
						<View className="gap-3">
							<Text>{gate.question}</Text>
							{gate.canAnswer ? (
								<Button
									className="self-start"
									onPress={() => router.push(answerHref(gate))}
								>
									<Text>Answer</Text>
								</Button>
							) : (
								<Text variant="muted" className="text-muted-foreground">
									Your role in this Space does not let you answer Gates.
								</Text>
							)}
						</View>
					</Fragment>
				))}
			</CardContent>
		</Card>
	);
}

/** The steps of the run, in the order they started. */
function StepsCard({
	steps,
	labels,
}: {
	steps: StepSummary[];
	labels: Map<string, string>;
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Steps</CardTitle>
			</CardHeader>
			<CardContent className="gap-3">
				{steps.length === 0 ? (
					<Text variant="muted" className="text-muted-foreground">
						The first step starts soon.
					</Text>
				) : (
					steps.map((step, index) => (
						<Fragment key={step.id}>
							{index > 0 ? <Separator /> : null}
							<View className="flex-row items-center justify-between gap-3">
								<View className="flex-1 gap-0.5">
									<Text numberOfLines={1}>{stepName(step, labels)}</Text>
									{step.error ? (
										<Text
											variant="muted"
											className="text-muted-foreground"
											numberOfLines={2}
										>
											{step.error}
										</Text>
									) : null}
								</View>
								<StepStateBadge
									state={stepState(step)}
									outcome={step.outcome}
								/>
							</View>
						</Fragment>
					))
				)}
			</CardContent>
		</Card>
	);
}
