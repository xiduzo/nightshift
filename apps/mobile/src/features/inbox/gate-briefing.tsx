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
	isDestructive,
	mayAnswer,
	maySend,
	needsConfirm,
	nodeLabels,
	type OpenGate,
	sentText,
	usageLabel,
} from "@nightshift/client";
import { Skeleton } from "@nightshift/ui-native/components/ui/skeleton";
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
	SquareTerminal,
	Ticket,
} from "lucide-react-native";
import { Alert } from "react-native";

import { useHostQueries } from "@/features/host";
import { HeaderToolbar } from "@/shared/header";
import {
	NativeCustomRow,
	type NativeIcon,
	NativeList,
	NativeRow,
	NativeSection,
	NativeTextRow,
} from "@/shared/native-list";
import { useWhileFocused } from "@/shared/refresh";
import {
	type AnswerBar,
	type GateQueue,
	SendSection,
	useQueueBar,
} from "./answer-bar";
import { AskScreen } from "./ask-screen";
import { BriefSections } from "./brief-sections";
import { ChoiceSection } from "./choice-section";
import { nextGate } from "./gate-list";
import { GateHead, GateUrgent, RunSteps } from "./gate-times";
import { LINK_WORD, stepsHint } from "./gate-view";
import { ProblemRow } from "./problem-row";
import { QuestionSections } from "./question-sections";
import { SentSection } from "./sent-section";
import {
	type GoneRefusal,
	type SentAnswer,
	useGateAnswer,
} from "./use-gate-answer";

/** What went out, in words: "Roll back", and "Fix the bug continues at Build." */
export type GateSent = { choice: string; outcome: string };

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

/** Your phone checks that it is you: the hint under the options. */
const CHECK_HINT =
	"Your phone checks that it is you before Night Shift sends your answer.";

/**
 * One open Gate in full, to answer it, as a native grouped list: why it
 * is urgent, the head, the brief, the details, what happened in the run,
 * what to check first, and the options in their flow color. In the Needs
 * you queue the bar above the tabs sends the chosen option. On the Gate
 * screen the last row does. A choice that ends the run, or a red one,
 * asks first. An Ask (ADR 10) is answered with a form.
 */
export function GateBriefing({
	gate,
	inbox,
	onRefresh,
	onSent,
	onGone,
	queue,
}: GateBriefingProps) {
	const { context, links } = gateParts(gate.question);
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
	const brief = briefView(gate);

	const chosen = gate.choices.find((choice) => choice.name === answer.choice);
	// An agent that asks continues with the note: its answer needs one.
	const answersAgent = gate.choices.some((choice) => choice.needsNote);
	const chosenRoute = chosen ? routes.get(chosen.name) : undefined;
	const answerable = mayAnswer(gate);

	function send() {
		if (!chosen) return;
		if (needsConfirm(chosen, chosenRoute)) {
			confirmSignOff(chosen, chosenRoute, gate.runTitle, () => {
				void answer.send();
			});
		} else void answer.send();
	}

	const bar: AnswerBar = {
		choice: chosen
			? {
					name: chosen.name,
					color: chosen.color ?? null,
					destructive: isDestructive(chosen),
				}
			: null,
		prompt: "Choose an answer",
		action:
			answerable && !answer.sent
				? {
						label: "Sign off",
						busyLabel: answer.checking ? "Checking…" : "Signing off…",
						busy: answer.checking || answer.sending,
						disabled: !maySend(gate, answer),
					}
				: null,
	};
	// An Ask gives its own bar.
	useQueueBar(gate.form ? undefined : queue, bar, send);

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

	const steps = run.data
		? stepsHint(
				run.data.steps.filter((step) => step.scope === null).length,
				null,
				usageLabel(run.data.metrics?.tokens, costLabel(run.data)),
			)
		: undefined;

	return (
		<>
			<HeaderToolbar
				placement="right"
				items={[
					...(queue?.right ?? []),
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
			<NativeList onRefresh={() => Promise.all([onRefresh(), run.refetch()])}>
				{queue?.lead}

				{answerable && !answer.sent ? <GateUrgent gate={gate} /> : null}

				<GateHead
					gate={gate}
					manySpaces={manySpaces}
					sent={answer.sent !== null}
					answerable={answerable}
				/>

				{answer.sent && !queue ? (
					<SentSection
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

				<NativeSection title="What happened" footer={steps}>
					{run.data ? (
						<NativeCustomRow>
							<RunSteps run={run.data} labels={labels} />
						</NativeCustomRow>
					) : run.isError ? (
						<NativeTextRow
							secondary
							text="The steps of this run did not load. Pull down to try again."
						/>
					) : (
						<NativeCustomRow>
							<Skeleton className="h-24 w-full rounded-xl" />
						</NativeCustomRow>
					)}
				</NativeSection>

				<CheckFirst
					links={links}
					runTitle={gate.runTitle}
					runId={gate.runId}
					runHref={runHref}
				/>

				{answer.sent ? null : gate.answerPending ? (
					<NativeSection title="Your answer">
						<NativeTextRow
							icon={{ sf: "checkmark.circle", lucide: CircleCheck }}
							text="**Someone already answered this Gate**"
							note={
								elsewhere
									? `The run continues when ${elsewhere} is online.`
									: "The run continues in a moment."
							}
						/>
					</NativeSection>
				) : !gate.canAnswer ? (
					<NativeSection title="Your answer">
						<NativeTextRow
							icon={{ sf: "eye", lucide: Eye }}
							text="**You can read this Gate only**"
							note={`Your role in ${gate.spaceName} does not let you answer Gates. Ask an owner or admin of the Space to answer it, or to give you another role.`}
						/>
					</NativeSection>
				) : (
					<>
						{gate.branchesWork ? (
							<NativeSection>
								<NativeTextRow
									icon={{ sf: "hourglass", lucide: Loader }}
									text="**The run is still busy**"
									note="Another branch of this run still works. You can sign off when its step ends."
								/>
							</NativeSection>
						) : null}
						<ChoiceSection
							title="Your answer"
							footer={
								[
									brief.impactsByModel
										? "Night Shift wrote what these answers do."
										: null,
									answerable && !gate.lockScreen ? CHECK_HINT : null,
								]
									.filter(Boolean)
									.join(" ") || undefined
							}
							choices={gate.choices}
							routes={routes}
							chosen={answer.choice}
							recommended={brief.recommendation?.option}
							onChoose={answer.choose}
							disabled={answer.busy}
						/>
						<NativeSection
							title={
								answersAgent
									? "Your answer to the agent"
									: "Note for the run (optional)"
							}
							footer={[
								answersAgent
									? "The agent gets your note as its answer, and continues."
									: "The next steps of the run get your note.",
								elsewhere
									? `Your answer goes to ${elsewhere}. The run continues when ${elsewhere} is online.`
									: null,
							]
								.filter(Boolean)
								.join(" ")}
						>
							<NativeCustomRow>
								<Textarea
									accessibilityLabel={
										answersAgent
											? "Your answer to the agent"
											: "Note for the run"
									}
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
							</NativeCustomRow>
						</NativeSection>
						{answer.problem ? (
							<NativeSection>
								<ProblemRow problem={answer.problem} />
							</NativeSection>
						) : null}
					</>
				)}

				{queue ? null : <SendSection bar={bar} onSend={send} />}
			</NativeList>
		</>
	);
}

const LINK_ICON: Record<GateLink["kind"], NativeIcon> = {
	pull: { sf: "arrow.triangle.pull", lucide: GitPullRequest },
	issue: { sf: "smallcircle.filled.circle", lucide: CircleDot },
	ticket: { sf: "ticket", lucide: Ticket },
	web: { sf: "globe", lucide: Globe },
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
		<NativeSection
			title="Check first"
			footer="Look at these before you answer."
		>
			{links.map((link) => (
				<NativeRow
					key={link.url}
					icon={LINK_ICON[link.kind]}
					title={link.label}
					subtitle={[
						link.label === LINK_WORD[link.kind] ? null : LINK_WORD[link.kind],
						link.short,
						link.where === link.short ? null : link.where,
					]
						.filter(Boolean)
						.join(" · ")}
					onPress={() =>
						router.push({
							pathname: "/gate-link",
							params: {
								url: link.url,
								label: link.label,
								short: link.short,
								where: link.where,
								kind: link.kind,
								from: runTitle,
							},
						})
					}
				/>
			))}
			<NativeRow
				icon={{ sf: "terminal", lucide: SquareTerminal }}
				title="Transcript"
				subtitle="What the agents said and did"
				onPress={() =>
					router.push({ pathname: "/transcript/[runId]", params: { runId } })
				}
			/>
			<NativeRow
				icon={{ sf: "play.circle", lucide: CirclePlay }}
				title="Open the run"
				subtitle={runTitle}
				onPress={() => router.push(runHref)}
			/>
		</NativeSection>
	);
}

/**
 * Before a choice that ends or stops the run, or a red one: are you
 * sure? The system's own alert, so it also shows when you send from the
 * bar above the tabs on another tab.
 */
function confirmSignOff(
	choice: GateChoice,
	route: ChoiceRoute | undefined,
	runTitle: string,
	onConfirm: () => void,
) {
	const words = confirmText(route, choice.name, runTitle);
	Alert.alert(
		words.title,
		[choice.description, words.body].filter(Boolean).join("\n\n"),
		[
			{ text: "Cancel", style: "cancel" },
			{
				text: `Sign off on ${choice.name}`,
				style: isDestructive(choice) ? "destructive" : "default",
				onPress: onConfirm,
			},
		],
	);
}
