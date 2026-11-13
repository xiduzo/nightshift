import {
	briefView,
	type ChoiceRoute,
	choiceRoutes,
	confirmText,
	costLabel,
	createRunQueries,
	createSpaceQueries,
	type GateChoice,
	type GateLink,
	gateParts,
	gateRun,
	isDestructive,
	mayAnswer,
	maySend,
	needsConfirm,
	nodeLabels,
	type OpenGate,
	sentText,
	usageLabel,
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
	buttonTextVariants,
	buttonVariants,
} from "@nightshift/ui-native/components/ui/button";
import { Icon } from "@nightshift/ui-native/components/ui/icon";
import { Label } from "@nightshift/ui-native/components/ui/label";
import { Skeleton } from "@nightshift/ui-native/components/ui/skeleton";
import {
	Text,
	TextClassContext,
} from "@nightshift/ui-native/components/ui/text";
import { Textarea } from "@nightshift/ui-native/components/ui/textarea";
import { useQuery } from "@tanstack/react-query";
import { type Href, router } from "expo-router";
import {
	CircleCheck,
	CircleDot,
	CirclePlay,
	Ellipsis,
	Eye,
	GitPullRequest,
	Globe,
	Loader,
	type LucideIcon,
	SquareTerminal,
	Ticket,
	Workflow,
} from "lucide-react-native";
import { type ReactNode, useState } from "react";
import { View } from "react-native";

import { useHostQueries } from "@/features/host";
import { ActionBar } from "@/shared/action-bar";
import { HeaderToolbar } from "@/shared/header";
import { ListGroup, ListRow, SectionHead } from "@/shared/list";
import { InlineMarkdown } from "@/shared/markdown";
import { Screen } from "@/shared/page";
import { useWhileFocused } from "@/shared/refresh";
import { AskScreen } from "./ask-screen";
import { BriefSections } from "./brief-sections";
import { ChoiceCards } from "./choice-cards";
import { Breadcrumbs } from "./gate-breadcrumbs";
import { nextGate } from "./gate-list";
import { GateStatus, GateUrgent, RunSteps } from "./gate-times";
import { LINK_WORD, stepsHint } from "./gate-view";
import { ProblemAlert } from "./problem-alert";
import { QuestionSections } from "./question-sections";
import { SentCard } from "./sent-card";
import {
	type GoneRefusal,
	type SentAnswer,
	useGateAnswer,
} from "./use-gate-answer";

/** What went out, in words: "Roll back", and "Fix the bug continues at Build." */
export type GateSent = { choice: string; outcome: string };

/**
 * The Gate in a queue of things that wait (Needs you): `lead` shows above
 * the Gate (where it is in the queue, and Skip). After the answer the
 * queue moves on, so no Sent card shows.
 */
export type GateQueue = { lead: ReactNode };

export type GateBriefingProps = {
	gate: OpenGate;
	/** Every open Gate, for the next one after this answer. */
	inbox: readonly OpenGate[];
	onRefresh: () => Promise<unknown>;
	onSent: (sent: GateSent) => void;
	onGone: (refusal: GoneRefusal) => void;
	queue?: GateQueue;
};

const NO_LABELS: ReadonlyMap<string, string> = new Map();

/**
 * One open Gate in full, to answer it: why it is urgent, the brief, the
 * details, what happened in the run, what to check first, and the
 * options in their flow color. The bar at the bottom sends the chosen
 * option in its color, after a check that it is you. An Ask (ADR 10) is
 * answered with a form. The Gate screen and the Needs you queue show it.
 */
export function GateBriefing({
	gate,
	inbox,
	onRefresh,
	onSent,
	onGone,
	queue,
}: GateBriefingProps) {
	const { headline, context, links } = gateParts(gate.question);
	const { flow } = gateRun(gate);
	const spaceQueries = useHostQueries(createSpaceQueries);
	const spaces = useQuery({ ...spaceQueries.list(), ...useWhileFocused() });
	const manySpaces = (spaces.data?.spaces.length ?? 1) > 1;
	const runQueries = useHostQueries(createRunQueries);
	const run = useQuery({ ...runQueries.get(gate.runId), ...useWhileFocused() });
	const labels = run.data ? nodeLabels(run.data) : NO_LABELS;
	const routes = choiceRoutes(run.data, gate, gate.choices, labels);
	const elsewhere =
		!gate.walker.thisDevice && gate.walker.name ? gate.walker.name : null;
	const answer = useGateAnswer(gate, {
		onSent: (sent: SentAnswer) =>
			onSent({
				choice: sent.choice,
				outcome: sentText(routes.get(sent.choice), gate.runTitle, elsewhere),
			}),
		onGone,
	});
	const [confirming, setConfirming] = useState(false);
	const brief = briefView(gate);

	const chosen = gate.choices.find((choice) => choice.name === answer.choice);
	// An agent that asks continues with the note: its answer needs one.
	const answersAgent = gate.choices.some((choice) => choice.needsNote);
	const chosenRoute = chosen ? routes.get(chosen.name) : undefined;
	const answerable = mayAnswer(gate);

	function send() {
		if (!chosen) return;
		if (needsConfirm(chosen, chosenRoute)) setConfirming(true);
		else void answer.send();
	}

	const runHref: Href = {
		pathname: "/runs/[runId]",
		params: { runId: gate.runId },
	};

	// An Ask (ADR 10) is answered with a form, not a choice.
	if (gate.form) {
		return (
			<AskScreen
				gate={gate}
				form={gate.form}
				inbox={inbox}
				manySpaces={manySpaces}
				onRefresh={onRefresh}
				onSent={onSent}
				onGone={onGone}
				queue={queue}
			/>
		);
	}

	return (
		<Screen
			onRefresh={() => Promise.all([onRefresh(), run.refetch()])}
			footer={
				answerable && !answer.sent ? (
					<ActionBar
						caption={chosen ? "Your answer" : undefined}
						label={chosen ? chosen.name : "Choose an answer"}
						destructive={chosen ? isDestructive(chosen) : false}
						color={chosen?.color}
						action={{
							label: "Send",
							onPress: send,
							disabled: !maySend(gate, answer),
							busy: answer.checking || answer.sending,
							busyLabel: answer.checking ? "Checking…" : "Sending…",
							variant:
								chosen && isDestructive(chosen) ? "destructive" : "default",
						}}
					/>
				) : undefined
			}
		>
			<HeaderToolbar
				placement="right"
				items={[
					{
						kind: "button",
						key: "more",
						label: "More actions",
						sf: "ellipsis",
						icon: Ellipsis,
						onPress: () =>
							router.push({
								pathname: "/gate-actions",
								params: { runId: gate.runId, stepId: gate.stepId },
							}),
					},
				]}
			/>

			{queue?.lead}

			{answerable && !answer.sent ? <GateUrgent gate={gate} /> : null}

			<View className="gap-3">
				<Breadcrumbs gate={gate} manySpaces={manySpaces} runHref={runHref} />
				<Text
					accessibilityRole="header"
					selectable
					className="font-bold text-2xl tracking-tight"
				>
					<InlineMarkdown text={headline} />
				</Text>
				<View className="flex-row flex-wrap items-center gap-2">
					<GateStatus
						openedAt={gate.openedAt}
						sent={answer.sent !== null}
						answerable={answerable}
					/>
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

			{answer.sent && !queue ? (
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

			<BriefSections brief={brief} />

			<QuestionSections context={context} />

			<View className="gap-2">
				<SectionHead
					title="What happened"
					hint={
						run.data
							? stepsHint(
									run.data.steps.filter((step) => step.scope === null).length,
									null,
									usageLabel(run.data.metrics?.tokens, costLabel(run.data)),
								)
							: undefined
					}
				/>
				{run.data ? (
					<RunSteps run={run.data} labels={labels} />
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
				runHref={runHref}
			/>

			{answer.sent ? null : (
				<View className="gap-3">
					<SectionHead
						title="Your answer"
						hint={
							answerable && !gate.lockScreen
								? "Your phone checks that it is you before Night Shift sends your answer."
								: undefined
						}
					/>
					{gate.answerPending ? (
						<Alert icon={CircleCheck}>
							<AlertTitle>Someone already answered this Gate</AlertTitle>
							<AlertDescription>
								{elsewhere
									? `The run continues when ${elsewhere} is online.`
									: "The run continues in a moment."}
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
							{gate.branchesWork ? (
								<Alert icon={Loader}>
									<AlertTitle>The run is still busy</AlertTitle>
									<AlertDescription>
										Another branch of this run still works. You can send your
										answer when its step ends.
									</AlertDescription>
								</Alert>
							) : null}
							<ChoiceCards
								choices={gate.choices}
								routes={routes}
								chosen={answer.choice}
								recommended={brief.recommendation?.option}
								onChoose={answer.choose}
								disabled={answer.busy}
							/>
							{brief.impactsByModel ? (
								<Text className="text-muted-foreground text-xs">
									Night Shift wrote what these answers do.
								</Text>
							) : null}
							<View className="gap-2">
								<Label nativeID="gate-note">
									{answersAgent
										? "Your answer to the agent"
										: "Note for the run (optional)"}
								</Label>
								<Textarea
									aria-labelledby="gate-note"
									value={answer.note}
									onChangeText={answer.setNote}
									placeholder={
										answersAgent
											? "Answer the agent's questions"
											: "Context for the next steps"
									}
									editable={!answer.busy}
									numberOfLines={4}
								/>
								<Text className="text-muted-foreground text-xs">
									{answersAgent
										? "The agent gets your note as its answer, and continues."
										: "The next steps of the run get your note."}
								</Text>
							</View>
							{elsewhere ? (
								<Text className="text-muted-foreground text-xs">
									{`Your answer goes to ${elsewhere}. The run continues when ${elsewhere} is online.`}
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
					route={chosenRoute}
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
	runHref,
}: {
	links: readonly GateLink[];
	runTitle: string;
	runId: string;
	runHref: Href;
}) {
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
				<ListRow
					icon={SquareTerminal}
					title="Transcript"
					caption="What the agents said and did"
					href={{ pathname: "/transcript/[runId]", params: { runId } }}
				/>
				<ListRow
					icon={CirclePlay}
					title="Open the run"
					caption={runTitle}
					href={runHref}
				/>
			</ListGroup>
		</View>
	);
}

/** Before a choice that ends or stops the run, or a red one: are you sure? */
function ConfirmDialog({
	open,
	onOpenChange,
	choice,
	route,
	runTitle,
	onConfirm,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	choice: GateChoice;
	route: ChoiceRoute | undefined;
	runTitle: string;
	onConfirm: () => void;
}) {
	const destructive = isDestructive(choice);
	const words = confirmText(route, choice.name, runTitle);
	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{words.title}</AlertDialogTitle>
					{choice.description ? (
						<AlertDialogDescription>
							{choice.description}
						</AlertDialogDescription>
					) : null}
					<AlertDialogDescription>{words.body}</AlertDialogDescription>
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
						{/* The Action gives its className to the text too: the label takes the text classes of its variant only. */}
						<TextClassContext.Provider
							value={buttonTextVariants({
								variant: destructive ? "destructive" : "default",
							})}
						>
							<Text>{`Send ${choice.name}`}</Text>
						</TextClassContext.Provider>
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
