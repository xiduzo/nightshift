import {
	choiceRoutes,
	costLabel,
	createRunQueries,
	createSpaceQueries,
	type GateChoice,
	type GateLink,
	gateParts,
	gateRefusalText,
	gateRun,
	nodeLabels,
	type OpenGate,
	waitedText,
} from "@nightshift/client";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui-native/components/ui/alert";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@nightshift/ui-native/components/ui/alert-dialog";
import { Badge } from "@nightshift/ui-native/components/ui/badge";
import {
	Button,
	buttonTextVariants,
	buttonVariants,
} from "@nightshift/ui-native/components/ui/button";
import { Card } from "@nightshift/ui-native/components/ui/card";
import { Icon } from "@nightshift/ui-native/components/ui/icon";
import { Label } from "@nightshift/ui-native/components/ui/label";
import { Skeleton } from "@nightshift/ui-native/components/ui/skeleton";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { Textarea } from "@nightshift/ui-native/components/ui/textarea";
import { useQuery } from "@tanstack/react-query";
import {
	type Href,
	Link,
	Redirect,
	router,
	Stack,
	useLocalSearchParams,
} from "expo-router";
import {
	ChevronRight,
	CircleAlert,
	CircleCheck,
	CircleDot,
	CirclePlay,
	Ellipsis,
	Eye,
	GitPullRequest,
	Globe,
	type LucideIcon,
	SquareTerminal,
	Ticket,
	Workflow,
} from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";

import { useHost, useHostQueries } from "@/features/host";
import { useSwitchSpace } from "@/features/spaces";
import { ActionBar } from "@/shared/action-bar";
import { EmptyState } from "@/shared/empty";
import { ErrorAlert } from "@/shared/feedback";
import { ListGroup, ListRow, SectionHead } from "@/shared/list";
import { Screen } from "@/shared/page";
import { StatusBadge } from "@/shared/status";
import { type Look, NEEDS_YOU } from "@/shared/tone";
import { StepTrail, trailItemOf } from "@/shared/trail";
import { CHECK_COPY } from "./answer-check";
import { ChoiceCards } from "./choice-cards";
import {
	isDestructive,
	LINK_WORD,
	needsConfirm,
	routeText,
	sentText,
	stepsHint,
} from "./gate-view";
import { nextGate } from "./inbox-view";
import { QuestionSections } from "./question-sections";
import { SentCard } from "./sent-card";
import { type Problem, useGateAnswer } from "./use-gate-answer";
import { useInbox } from "./use-inbox";
import { useNow } from "./use-now";

/**
 * One open Gate, to answer it: `gates/<runId>/<stepId>`, also the link
 * that a notification opens. Signed out, the person signs in first.
 */
export function GateAnswerScreen() {
	const { state } = useHost();
	if (state.status === "loading") return <Screen>{null}</Screen>;
	if (state.status === "signed-out") return <Redirect href="/connect" />;
	return <GateAnswer />;
}

function GateAnswer() {
	const { runId, stepId } = useLocalSearchParams<{
		runId: string;
		stepId: string;
	}>();
	const inbox = useInbox();
	const [closed, setClosed] = useState(false);
	/** The answer went: the screen keeps the Gate while the inbox drops it. */
	const [sent, setSent] = useState<OpenGate | null>(null);
	const gate =
		inbox.data?.find(
			(open) => open.runId === runId && open.stepId === stepId,
		) ?? sent;

	if (closed) return <ClosedGate {...gateRefusalText("closed")} />;
	if (gate) {
		return (
			<OpenGateScreen
				key={`${gate.runId}:${gate.stepId}`}
				gate={gate}
				inbox={inbox.data ?? []}
				onRefresh={() => inbox.refetch()}
				onSent={() => setSent(gate)}
				onClosed={() => setClosed(true)}
			/>
		);
	}
	if (inbox.data) {
		return (
			<ClosedGate
				title="This Gate does not wait anymore"
				description="Someone answered it, or its run ended. Your inbox shows what still waits for you."
			/>
		);
	}
	return (
		<Screen onRefresh={() => inbox.refetch()}>
			{inbox.error ? (
				<ErrorAlert
					title="The Gate did not load"
					message="Check that this phone is online. Then try again."
					onRetry={() => void inbox.refetch()}
				/>
			) : (
				<>
					<Skeleton className="h-5 w-1/2" />
					<Skeleton className="h-16 w-full" />
					<Skeleton className="h-8 w-2/3 rounded-full" />
					<Skeleton className="h-32 w-full rounded-xl" />
					<Skeleton className="h-24 w-full rounded-xl" />
				</>
			)}
		</Screen>
	);
}

function ClosedGate({
	title,
	description,
}: {
	title: string;
	description: string;
}) {
	return (
		<Screen>
			<EmptyState icon={CircleCheck} title={title} description={description}>
				<Button
					size="lg"
					onPress={() => router.dismissTo("/inbox")}
					className="h-auto min-h-11 py-2"
				>
					<Text>Back to Inbox</Text>
				</Button>
			</EmptyState>
		</Screen>
	);
}

const NO_LABELS: ReadonlyMap<string, string> = new Map();

function OpenGateScreen({
	gate,
	inbox,
	onRefresh,
	onSent,
	onClosed,
}: {
	gate: OpenGate;
	/** Every open Gate, for the next one after this answer. */
	inbox: readonly OpenGate[];
	onRefresh: () => Promise<unknown>;
	onSent: () => void;
	onClosed: () => void;
}) {
	const now = useNow();
	const { headline, context, links } = gateParts(gate.question);
	const { flow } = gateRun(gate);
	const spaceQueries = useHostQueries(createSpaceQueries);
	const spaces = useQuery(spaceQueries.list());
	/** The run's steps and flow load only in the Space this phone works in. */
	const sameSpace = spaces.data?.active === gate.spaceId;
	const manySpaces = (spaces.data?.spaces.length ?? 1) > 1;
	const runQueries = useHostQueries(createRunQueries);
	const run = useQuery({
		...runQueries.get(gate.runId),
		enabled: sameSpace,
	});
	const labels = run.data ? nodeLabels(run.data) : NO_LABELS;
	const routes = choiceRoutes(run.data, gate, gate.choices, labels);
	const answer = useGateAnswer(gate, { onSent, onClosed });
	const [confirming, setConfirming] = useState(false);

	const chosen = gate.choices.find((choice) => choice.name === answer.choice);
	const chosenRoute = chosen ? routes.get(chosen.name) : undefined;
	const answerable = gate.canAnswer && !gate.answerPending;
	const elsewhere =
		!gate.walker.thisDevice && gate.walker.name ? gate.walker.name : null;
	const waited = waitedText(now - gate.openedAt);

	function send() {
		if (!chosen) return;
		if (needsConfirm(chosen, chosenRoute)) setConfirming(true);
		else void answer.send();
	}

	const status: Look = answer.sent
		? { tone: "finished", icon: "circle-check", label: "Answered" }
		: answerable
			? { ...NEEDS_YOU, label: `Needs you · ${waited}` }
			: { tone: "neutral", icon: "hourglass", label: `Waiting ${waited}` };

	const runHref: Href = {
		pathname: "/runs/[runId]",
		params: { runId: gate.runId },
	};

	return (
		<Screen
			onRefresh={() =>
				Promise.all([onRefresh(), sameSpace ? run.refetch() : null])
			}
			footer={
				answerable && !answer.sent ? (
					<ActionBar
						caption={chosen ? "Your answer" : undefined}
						label={chosen ? chosen.name : "Choose an answer"}
						destructive={chosen ? isDestructive(chosen) : false}
						action={{
							label: "Send",
							onPress: send,
							disabled: !chosen,
							busy: answer.checking || answer.sending,
							busyLabel: answer.checking ? "Checking…" : "Sending…",
							variant:
								chosen && isDestructive(chosen) ? "destructive" : "default",
						}}
					/>
				) : undefined
			}
		>
			{sameSpace ? (
				<Stack.Screen
					options={{
						headerRight: () => (
							<Button
								variant="ghost"
								size="icon"
								className="size-11"
								onPress={() =>
									router.push({
										pathname: "/gate-actions",
										params: { runId: gate.runId, stepId: gate.stepId },
									})
								}
								accessibilityLabel="More actions"
							>
								<Icon as={Ellipsis} className="size-5" />
							</Button>
						),
					}}
				/>
			) : null}

			<View className="gap-3">
				<Breadcrumbs
					gate={gate}
					manySpaces={manySpaces}
					linked={sameSpace}
					runHref={runHref}
				/>
				<Text
					accessibilityRole="header"
					selectable
					className="font-bold text-2xl tracking-tight"
				>
					{headline}
				</Text>
				<View className="flex-row flex-wrap items-center gap-2">
					<StatusBadge look={status} />
					<Badge variant="outline">
						<Icon as={Workflow} className="size-3 text-muted-foreground" />
						<Text numberOfLines={1}>{flow}</Text>
					</Badge>
					<Badge variant="outline" accessibilityLabel={`Step ${gate.nodeId}`}>
						<Text className="font-mono" numberOfLines={1}>
							{gate.nodeId}
						</Text>
					</Badge>
				</View>
			</View>

			{answer.sent ? (
				<SentCard
					answer={answer.sent}
					outcome={sentText(
						routes.get(answer.sent.choice),
						gate.runTitle,
						elsewhere,
					)}
					next={nextGate(inbox, gate)}
				/>
			) : null}

			<QuestionSections context={context} />

			<View className="gap-2">
				<SectionHead
					title="What happened"
					hint={
						run.data
							? stepsHint(
									run.data.steps.filter((step) => step.scope === null).length,
									null,
									costLabel(run.data),
								)
							: undefined
					}
				/>
				{!spaces.data ? (
					<Skeleton className="h-24 w-full rounded-xl" />
				) : !sameSpace ? (
					<OtherSpace spaceId={gate.spaceId} spaceName={gate.spaceName} />
				) : run.data ? (
					<Card className="px-4 py-4">
						<StepTrail
							items={run.data.steps
								.filter((step) => step.scope === null)
								.map((step) =>
									trailItemOf(step, {
										labels,
										runStatus: run.data.status,
										now,
									}),
								)}
						/>
					</Card>
				) : run.isError ? (
					<Text className="text-muted-foreground text-sm">
						The steps of this run did not load. Pull down to try again.
					</Text>
				) : (
					<Skeleton className="h-32 w-full rounded-xl" />
				)}
			</View>

			<CheckFirst
				links={links}
				runTitle={gate.runTitle}
				runId={gate.runId}
				linked={sameSpace}
				runHref={runHref}
			/>

			{answer.sent ? null : (
				<View className="gap-3">
					<SectionHead
						title="Your answer"
						hint={
							answerable && !answer.sent && !gate.lockScreen
								? "Your phone checks that it is you before Night Shift sends your answer."
								: undefined
						}
					/>
					{gate.answerPending ? (
						<Alert icon={CircleCheck}>
							<AlertTitle>Someone already answered this Gate</AlertTitle>
							<AlertDescription>
								{elsewhere
									? `The run goes on when ${elsewhere} is online.`
									: "The run goes on in a moment."}
							</AlertDescription>
						</Alert>
					) : !gate.canAnswer ? (
						<Alert icon={Eye}>
							<AlertTitle>You can read this Gate only</AlertTitle>
							<AlertDescription>
								{`Your role in ${gate.spaceName} does not let you answer Gates. Ask an owner or admin of the Space to answer it, or to give you another role.`}
							</AlertDescription>
						</Alert>
					) : (
						<>
							<ChoiceCards
								choices={gate.choices}
								routes={routes}
								chosen={answer.choice}
								onChoose={answer.choose}
								disabled={answer.busy}
							/>
							<View className="gap-2">
								<Label nativeID="gate-note">Note for the run (optional)</Label>
								<Textarea
									aria-labelledby="gate-note"
									value={answer.note}
									onChangeText={answer.setNote}
									placeholder="Context for the next steps"
									editable={!answer.busy}
									numberOfLines={4}
								/>
								<Text className="text-muted-foreground text-xs">
									The next steps of the run get your note.
								</Text>
							</View>
							{elsewhere ? (
								<Text className="text-muted-foreground text-xs">
									{`Your answer goes to ${elsewhere}. The run goes on when ${elsewhere} is online.`}
								</Text>
							) : null}
							{answer.problem ? (
								<ProblemAlert problem={answer.problem} />
							) : null}
						</>
					)}
				</View>
			)}

			{chosen ? (
				<ConfirmDialog
					open={confirming}
					onOpenChange={setConfirming}
					choice={chosen}
					next={routeText(chosenRoute)}
					ends={chosenRoute?.kind === "end" || chosenRoute?.kind === "limit"}
					runTitle={gate.runTitle}
					onConfirm={() => {
						setConfirming(false);
						void answer.send();
					}}
				/>
			) : null}
		</Screen>
	);
}

/** "Acme › website › Fix the login bug": the project and the run open their screens. */
function Breadcrumbs({
	gate,
	manySpaces,
	linked,
	runHref,
}: {
	gate: OpenGate;
	manySpaces: boolean;
	linked: boolean;
	runHref: Href;
}) {
	return (
		<View className="flex-row flex-wrap items-center gap-x-1">
			{manySpaces ? (
				<>
					<Text className="text-muted-foreground text-sm">
						{gate.spaceName}
					</Text>
					<Icon as={ChevronRight} className="size-3.5 text-muted-foreground" />
				</>
			) : null}
			<Crumb
				label={gate.projectName}
				href={
					linked
						? {
								pathname: "/projects/[projectId]",
								params: { projectId: gate.projectId },
							}
						: undefined
				}
			/>
			<Icon as={ChevronRight} className="size-3.5 text-muted-foreground" />
			<Crumb label={gate.runTitle} href={linked ? runHref : undefined} />
		</View>
	);
}

function Crumb({ label, href }: { label: string; href: Href | undefined }) {
	if (!href) {
		return (
			<Text className="flex-shrink text-muted-foreground text-sm">{label}</Text>
		);
	}
	return (
		<Link href={href} asChild>
			<Button
				variant="link"
				size="sm"
				className="h-auto min-h-11 flex-shrink px-0 py-2"
			>
				<Text className="text-sm" numberOfLines={1}>
					{label}
				</Text>
			</Button>
		</Link>
	);
}

/** The run is in another Space than the one this phone works in. */
function OtherSpace({
	spaceId,
	spaceName,
}: {
	spaceId: string;
	spaceName: string;
}) {
	const switchSpace = useSwitchSpace();
	return (
		<Card className="gap-3 px-4 py-4">
			<Text className="text-muted-foreground text-sm">
				{`This run is in ${spaceName}. Switch to that Space to see its steps and where each choice leads.`}
			</Text>
			<Button
				size="lg"
				variant="outline"
				className="h-auto min-h-11 self-start py-2"
				disabled={switchSpace.isPending}
				onPress={() => switchSpace.mutate({ spaceId })}
			>
				<Text>
					{switchSpace.isPending ? "Switching…" : `Switch to ${spaceName}`}
				</Text>
			</Button>
		</Card>
	);
}

const LINK_ICON: Record<GateLink["kind"], LucideIcon> = {
	pull: GitPullRequest,
	issue: CircleDot,
	ticket: Ticket,
	web: Globe,
};

/** What to look at before you answer: the question's links, the transcript and the run. */
function CheckFirst({
	links,
	runTitle,
	runId,
	linked,
	runHref,
}: {
	links: readonly GateLink[];
	runTitle: string;
	runId: string;
	linked: boolean;
	runHref: Href;
}) {
	if (links.length === 0 && !linked) return null;
	return (
		<View className="gap-2">
			<SectionHead
				title="Check first"
				hint="Look at these before you answer."
			/>
			<ListGroup>
				{links.map((link) => (
					<ListRow
						key={link.url}
						icon={LINK_ICON[link.kind]}
						title={link.label}
						titleLines={1}
						caption={[
							link.label === LINK_WORD[link.kind] ? "" : LINK_WORD[link.kind],
							{ text: link.short, mono: link.kind !== "web" },
							link.where === link.short ? "" : link.where,
						]}
						href={{
							pathname: "/gate-link",
							params: {
								url: link.url,
								label: link.label,
								short: link.short,
								where: link.where,
								kind: link.kind,
								from: runTitle,
							},
						}}
						accessibilityHint="Shows the link and a button to open it"
					/>
				))}
				{linked ? (
					<ListRow
						icon={SquareTerminal}
						title="Transcript"
						caption="What the agents said and did"
						href={{ pathname: "/transcript/[runId]", params: { runId } }}
					/>
				) : null}
				{linked ? (
					<ListRow
						icon={CirclePlay}
						title="Open the run"
						caption={runTitle}
						href={runHref}
					/>
				) : null}
			</ListGroup>
		</View>
	);
}

/** Before a choice that ends the run, or a red one: are you sure? */
function ConfirmDialog({
	open,
	onOpenChange,
	choice,
	next,
	ends,
	runTitle,
	onConfirm,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	choice: GateChoice;
	next: string | null;
	ends: boolean;
	runTitle: string;
	onConfirm: () => void;
}) {
	const destructive = isDestructive(choice);
	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						{ends ? "End the run?" : `Send ${choice.name}?`}
					</AlertDialogTitle>
					{choice.description ? (
						<AlertDialogDescription>
							{choice.description}
						</AlertDialogDescription>
					) : null}
					<AlertDialogDescription>
						{ends
							? `This answer ends the run ${runTitle}.`
							: next
								? `${next} in the run ${runTitle}.`
								: `The run ${runTitle} gets this answer.`}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>
						<Text>Cancel</Text>
					</AlertDialogCancel>
					<AlertDialogAction
						className={
							destructive
								? buttonVariants({ variant: "destructive" })
								: undefined
						}
						onPress={onConfirm}
					>
						<Text
							className={
								destructive
									? buttonTextVariants({ variant: "destructive" })
									: undefined
							}
						>
							{`Send ${choice.name}`}
						</Text>
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

function ProblemAlert({ problem }: { problem: Problem }) {
	const copy =
		problem.kind === "check"
			? CHECK_COPY[problem.failure]
			: problem.kind === "refused"
				? gateRefusalText(problem.refusal)
				: problem.kind === "unreachable"
					? problem.text
					: {
							title: "Your answer was not sent",
							description: `${problem.message} Check that this phone is online. Then send it again.`,
						};
	return (
		<Alert icon={CircleAlert} variant="destructive">
			<AlertTitle>{copy.title}</AlertTitle>
			<AlertDescription>{copy.description}</AlertDescription>
		</Alert>
	);
}
