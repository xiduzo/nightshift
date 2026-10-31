import {
	type AskValues,
	askAnswerOf,
	askStartValues,
	deadlineText,
	gateParts,
	type OpenGate,
	phoneCanAnswer,
} from "@nightshift/client";
import type { AskForm } from "@nightshift/flows";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui-native/components/ui/alert";
import { Button } from "@nightshift/ui-native/components/ui/button";
import { Icon } from "@nightshift/ui-native/components/ui/icon";
import { Text } from "@nightshift/ui-native/components/ui/text";
import type { Href } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { CircleCheck, ExternalLink, Eye, Globe } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";

import { useSignedIn } from "@/features/host";
import { ActionBar } from "@/shared/action-bar";
import { SectionHead } from "@/shared/list";
import { Screen } from "@/shared/page";
import { AskFields } from "./ask-fields";
import { AskFiles } from "./ask-files";
import { askSentSummary, askWebUrl } from "./ask-view";
import { Breadcrumbs } from "./gate-breadcrumbs";
import { nextGate } from "./gate-list";
import { GateStatus } from "./gate-times";
import { sentText } from "./gate-view";
import { InlineMarkdown } from "./markdown";
import { ProblemAlert } from "./problem-alert";
import { QuestionSections } from "./question-sections";
import { SentCard } from "./sent-card";
import { type GoneRefusal, useGateAnswer } from "./use-gate-answer";

/**
 * One open Ask (ADR 10), to answer it: a form drawn from the output schema.
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
	projectHere,
	onRefresh,
	onSent,
	onGone,
}: {
	gate: OpenGate;
	form: AskForm;
	inbox: readonly OpenGate[];
	manySpaces: boolean;
	projectHere: boolean;
	onRefresh: () => Promise<unknown>;
	onSent: () => void;
	onGone: (refusal: GoneRefusal) => void;
}) {
	const { host } = useSignedIn();
	const { headline, context } = gateParts(gate.question);
	const [values, setValues] = useState<AskValues>(() => askStartValues(form));
	const [tried, setTried] = useState(false);
	const answer = useGateAnswer(gate, { onSent, onGone });
	const native = phoneCanAnswer(form);
	const ready = askAnswerOf(form, values);
	const answerable = gate.canAnswer && !gate.answerPending;
	const elsewhere =
		!gate.walker.thisDevice && gate.walker.name ? gate.walker.name : null;
	const files = {
		runId: gate.runId,
		address: host.address,
		walkedHere: gate.walker.thisDevice,
	};
	const runHref: Href = {
		pathname: "/runs/[runId]",
		params: { runId: gate.runId },
	};

	function send() {
		setTried(true);
		if ("data" in ready) void answer.sendForm(ready.data);
	}

	return (
		<Screen
			onRefresh={onRefresh}
			footer={
				native && answerable && !answer.sent ? (
					<ActionBar
						caption="Your answer"
						label={"data" in ready ? "Ready to send" : "Fill in the form"}
						action={{
							label: "Send",
							onPress: send,
							disabled: false,
							busy: answer.checking || answer.sending,
							busyLabel: answer.checking ? "Checking…" : "Sending…",
							variant: "default",
						}}
					/>
				) : undefined
			}
		>
			<View className="gap-3">
				<Breadcrumbs
					gate={gate}
					manySpaces={manySpaces}
					projectHere={projectHere}
					runHref={runHref}
				/>
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
				</View>
			</View>

			{answer.sent ? (
				<SentCard
					answer={{
						choice: askSentSummary(form, answer.sent.data),
						note: null,
					}}
					outcome={sentText(undefined, gate.runTitle, elsewhere)}
					next={nextGate(inbox, gate)}
				/>
			) : null}

			<QuestionSections context={context} />

			{form.attachments && form.attachments.length > 0 ? (
				<View className="gap-2">
					<SectionHead title="Files and links" />
					<AskFiles attachments={form.attachments} {...files} />
				</View>
			) : null}

			{answer.sent ? null : (
				<View className="gap-3">
					<SectionHead
						title="Your answer"
						hint={
							native && answerable
								? "Your phone checks that it is you before Night Shift sends your answer."
								: undefined
						}
					/>
					{gate.answerPending ? (
						<Alert icon={CircleCheck}>
							<AlertTitle>Someone already answered this question</AlertTitle>
							<AlertDescription>
								{elsewhere
									? `The run continues when ${elsewhere} is online.`
									: "The run continues in a moment."}
							</AlertDescription>
						</Alert>
					) : !gate.canAnswer ? (
						<Alert icon={Eye}>
							<AlertTitle>You can read this question only</AlertTitle>
							<AlertDescription>
								{`Your role in ${gate.spaceName} does not let you answer. Ask an owner or admin of the Space to answer it, or to give you another role.`}
							</AlertDescription>
						</Alert>
					) : native ? (
						<>
							<AskFields
								form={form}
								values={values}
								onChange={(name, value) =>
									setValues((current) => ({ ...current, [name]: value }))
								}
								disabled={answer.busy}
								files={files}
							/>
							{tried && "problem" in ready ? (
								<Text className="text-destructive text-sm">
									{ready.problem}
								</Text>
							) : null}
						</>
					) : (
						<>
							<Alert icon={Globe}>
								<AlertTitle>Answer this question on the web</AlertTitle>
								<AlertDescription>
									This form has fields that the phone cannot show yet.
								</AlertDescription>
							</Alert>
							<Button
								size="lg"
								onPress={() =>
									void WebBrowser.openBrowserAsync(
										askWebUrl(host.address, gate),
									)
								}
								accessibilityHint="Opens the question in the browser"
								className="h-auto min-h-11 py-2"
							>
								<Text>Open in the browser</Text>
								<Icon as={ExternalLink} className="text-primary-foreground" />
							</Button>
						</>
					)}
					{gate.deadline && answerable ? (
						<Text className="text-muted-foreground text-xs">
							{deadlineText(gate.deadline, Date.now(), form)}
						</Text>
					) : null}
					{elsewhere && native && answerable ? (
						<Text className="text-muted-foreground text-xs">
							{`Your answer goes to ${elsewhere}. The run continues when ${elsewhere} is online.`}
						</Text>
					) : null}
					{answer.problem ? <ProblemAlert problem={answer.problem} /> : null}
				</View>
			)}
		</Screen>
	);
}
