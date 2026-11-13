import {
	type AskValues,
	askAnswerOf,
	askStartValues,
	briefView,
	gateParts,
	mayAnswer,
	type OpenGate,
	phoneCanAnswer,
	sentText,
} from "@nightshift/client";
import type { AskForm } from "@nightshift/flows";
import * as WebBrowser from "expo-web-browser";
import {
	CircleAlert,
	CircleCheck,
	ExternalLink,
	Eye,
	Globe,
	Loader,
} from "lucide-react-native";
import { useState } from "react";

import { useSignedIn } from "@/features/host";
import { HeaderToolbar } from "@/shared/header";
import {
	NativeButtonRow,
	NativeCustomRow,
	NativeList,
	NativeSection,
	NativeTextRow,
} from "@/shared/native-list";
import { useThemeColors } from "@/shared/theme";
import {
	type AnswerBar,
	type GateQueue,
	SendSection,
	useQueueBar,
} from "./answer-bar";
import { AskFields } from "./ask-fields";
import { AskFiles } from "./ask-files";
import { askSentSummary, askWebUrl } from "./ask-view";
import { BriefSections } from "./brief-sections";
import type { GateSent } from "./gate-briefing";
import { nextGate } from "./gate-list";
import { GateHead, GateUrgent } from "./gate-times";
import { ProblemRow } from "./problem-row";
import { QuestionSections } from "./question-sections";
import { SentSection } from "./sent-section";
import { type GoneRefusal, useGateAnswer } from "./use-gate-answer";

/**
 * One open Ask (ADR 10), to answer it: its brief (Situation, Background),
 * then a form drawn from the output schema.
 * The phone draws a form of text, choices, switches and numbers itself;
 * any other form opens its page in Night Shift on the web. The images of a
 * run the Host walks show inline. The phone checks that it is you before
 * the answer goes, as for a Gate.
 */
export function AskScreen({
	gate,
	form,
	inbox,
	manySpaces,
	onRefresh,
	onSent,
	onGone,
	queue,
}: {
	gate: OpenGate;
	form: AskForm;
	inbox: readonly OpenGate[];
	manySpaces: boolean;
	onRefresh: () => Promise<unknown>;
	onSent: (sent: GateSent) => void;
	onGone: (refusal: GoneRefusal) => void;
	/** In the Needs you queue: what shows at the top, in the header and in the bar above the tabs. */
	queue?: GateQueue;
}) {
	const { host } = useSignedIn();
	const { colors } = useThemeColors();
	const { context } = gateParts(gate.question);
	const [values, setValues] = useState<AskValues>(() => askStartValues(form));
	const [tried, setTried] = useState(false);
	const elsewhere =
		!gate.walker.thisDevice && gate.walker.name ? gate.walker.name : null;
	const answer = useGateAnswer(gate, {
		onSent: (sent) =>
			onSent({
				choice: askSentSummary(form, sent.data),
				outcome: sentText(undefined, gate.runTitle, elsewhere),
			}),
		onGone,
	});
	const native = phoneCanAnswer(form);
	const ready = askAnswerOf(form, values);
	const answerable = mayAnswer(gate);
	const files = {
		runId: gate.runId,
		address: host.address,
		walkedHere: gate.walker.thisDevice,
	};

	function send() {
		setTried(true);
		if ("data" in ready) void answer.sendForm(ready.data);
	}

	const bar: AnswerBar = {
		choice: null,
		prompt: "data" in ready ? "Ready to send" : "Fill in the form",
		action:
			native && answerable && !answer.sent
				? {
						label: "Send",
						busyLabel: answer.checking ? "Checking…" : "Sending…",
						busy: answer.checking || answer.sending,
						disabled: gate.branchesWork,
					}
				: null,
	};
	useQueueBar(queue, bar, send);

	return (
		<>
			{queue && queue.right.length > 0 ? (
				<HeaderToolbar placement="right" items={queue.right} />
			) : null}
			<NativeList onRefresh={onRefresh}>
				{queue?.lead}

				{answerable && !answer.sent ? <GateUrgent gate={gate} /> : null}

				<GateHead
					gate={gate}
					manySpaces={manySpaces}
					sent={answer.sent !== null}
					answerable={answerable}
					flowAndStep={false}
				/>

				{answer.sent && !queue ? (
					<SentSection
						answer={{
							choice: askSentSummary(form, answer.sent.data),
							note: null,
						}}
						outcome={sentText(undefined, gate.runTitle, elsewhere)}
						next={nextGate(inbox, gate)}
					/>
				) : null}

				<BriefSections brief={briefView(gate)} />

				<QuestionSections context={context} />

				{form.attachments && form.attachments.length > 0 ? (
					<NativeSection title="Files and links">
						<NativeCustomRow>
							<AskFiles attachments={form.attachments} {...files} />
						</NativeCustomRow>
					</NativeSection>
				) : null}

				{answer.sent ? null : gate.answerPending ? (
					<NativeSection title="Your answer">
						<NativeTextRow
							icon={{ sf: "checkmark.circle", lucide: CircleCheck }}
							text="**Someone already answered this question**"
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
							text="**You can read this question only**"
							note={`Your role in ${gate.spaceName} does not let you answer. Ask an owner or admin of the Space to answer it, or to give you another role.`}
						/>
					</NativeSection>
				) : native ? (
					<>
						{gate.branchesWork ? (
							<NativeSection>
								<NativeTextRow
									icon={{ sf: "hourglass", lucide: Loader }}
									text="**The run is still busy**"
									note="Another branch of this run still works. You can send your answer when its step ends."
								/>
							</NativeSection>
						) : null}
						<NativeSection
							title="Your answer"
							footer={[
								answerable
									? "Your phone checks that it is you before Night Shift sends your answer."
									: null,
								elsewhere
									? `Your answer goes to ${elsewhere}. The run continues when ${elsewhere} is online.`
									: null,
							]
								.filter(Boolean)
								.join(" ")}
						>
							<NativeCustomRow>
								<AskFields
									form={form}
									values={values}
									onChange={(name, value) =>
										setValues((current) => ({ ...current, [name]: value }))
									}
									disabled={answer.busy}
									files={files}
								/>
							</NativeCustomRow>
							{tried && "problem" in ready ? (
								<NativeTextRow
									icon={{
										sf: "exclamationmark.circle.fill",
										lucide: CircleAlert,
									}}
									iconColor={colors.destructive}
									text={ready.problem}
								/>
							) : null}
						</NativeSection>
					</>
				) : (
					<NativeSection title="Your answer">
						<NativeTextRow
							icon={{ sf: "globe", lucide: Globe }}
							text="**Answer this question on the web**"
							note="This form has fields that the phone cannot show yet."
						/>
						<NativeButtonRow
							label="Open in the browser"
							icon={{ sf: "arrow.up.right.square", lucide: ExternalLink }}
							onPress={() =>
								void WebBrowser.openBrowserAsync(askWebUrl(host.address, gate))
							}
						/>
					</NativeSection>
				)}

				{answer.problem ? (
					<NativeSection>
						<ProblemRow problem={answer.problem} />
					</NativeSection>
				) : null}

				{queue ? null : <SendSection bar={bar} onSend={send} />}
			</NativeList>
		</>
	);
}
