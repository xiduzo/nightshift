import {
	type ContextItem,
	createGateMutations,
	createGateQueries,
	createRunQueries,
	type GateLink,
	gateParts,
	isGateClosed,
	type OpenGate,
	waitedText,
} from "@nightshift/client";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui-native/components/ui/alert";
import { Badge } from "@nightshift/ui-native/components/ui/badge";
import { Button } from "@nightshift/ui-native/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@nightshift/ui-native/components/ui/card";
import { Icon } from "@nightshift/ui-native/components/ui/icon";
import { Label } from "@nightshift/ui-native/components/ui/label";
import { Separator } from "@nightshift/ui-native/components/ui/separator";
import { Skeleton } from "@nightshift/ui-native/components/ui/skeleton";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { Textarea } from "@nightshift/ui-native/components/ui/textarea";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import {
	CircleAlert,
	CircleCheck,
	ExternalLink,
	Eye,
	Fingerprint,
} from "lucide-react-native";
import { useState } from "react";
import { ScrollView, View } from "react-native";

import { useHost, useHostQueries } from "@/features/host";
import { EmptyState } from "@/shared/empty";
import { Screen } from "@/shared/page";
import { CHECK_COPY, type CheckFailure } from "./answer-check";
import { confirmAnswer } from "./answered";
import { checkBeforeAnswer } from "./person-check";
import { useInbox } from "./use-inbox";
import { useNow } from "./use-now";

/**
 * One open Gate, to answer it: `gates/<runId>/<stepId>`, also the link that
 * a notification opens. Signed out, the person signs in first.
 */
export function GateAnswerScreen() {
	const { state } = useHost();
	if (state.status === "loading") return <Screen>{null}</Screen>;
	if (state.status === "signed-out") return <Redirect href="/connect" />;
	return <GateAnswer />;
}

/** What went wrong with the last answer. */
type Problem =
	| { kind: "check"; failure: CheckFailure }
	| { kind: "failed"; message: string };

function GateAnswer() {
	const { runId, stepId } = useLocalSearchParams<{
		runId: string;
		stepId: string;
	}>();
	const inbox = useInbox();
	const [closed, setClosed] = useState(false);
	/** The answer went: the sheet keeps the Gate while it slides away. */
	const [sent, setSent] = useState<OpenGate | null>(null);
	const gate =
		inbox.data?.find(
			(open) => open.runId === runId && open.stepId === stepId,
		) ?? sent;

	if (closed) {
		return (
			<ClosedGate
				title="Someone already answered this Gate"
				description="Night Shift did not send your answer. Your inbox no longer shows this Gate."
			/>
		);
	}
	if (gate) {
		return (
			<OpenGateSheet
				gate={gate}
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
				<Alert icon={CircleAlert} variant="destructive">
					<AlertTitle>The Gate did not load</AlertTitle>
					<AlertDescription>
						Check that this phone is online. Then try again.
					</AlertDescription>
					<Button
						variant="outline"
						size="sm"
						className="mt-2 self-start"
						onPress={() => void inbox.refetch()}
					>
						<Text>Try again</Text>
					</Button>
				</Alert>
			) : (
				<>
					<Skeleton className="h-6 w-1/3" />
					<Skeleton className="h-16 w-full" />
					<Skeleton className="h-32 w-full" />
					<Skeleton className="h-12 w-full" />
					<Skeleton className="h-12 w-full" />
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
				<Button onPress={goBack}>
					<Text>Open the inbox</Text>
				</Button>
			</EmptyState>
		</Screen>
	);
}

/** Back to where the person came from; from a notification, to the inbox. */
function goBack() {
	if (router.canGoBack()) router.back();
	else router.replace("/");
}

function OpenGateSheet({
	gate,
	onSent,
	onClosed,
}: {
	gate: OpenGate;
	/** The Host took the answer. */
	onSent(): void;
	/** The Host refused the answer: the Gate closed in the meantime. */
	onClosed(): void;
}) {
	const now = useNow();
	const { headline, context, links } = gateParts(gate.question);
	const gateQueries = useHostQueries(createGateQueries);
	const runQueries = useHostQueries(createRunQueries);
	const mutations = useHostQueries(createGateMutations);
	const queryClient = useQueryClient();
	const [note, setNote] = useState("");
	const [checking, setChecking] = useState<string | null>(null);
	const [problem, setProblem] = useState<Problem | null>(null);

	/** Takes this Gate out of the inbox at once; the refetch confirms it. */
	function dropGate() {
		queryClient.setQueryData<OpenGate[]>(gateQueries.open().queryKey, (gates) =>
			gates?.filter(
				(open) => open.runId !== gate.runId || open.stepId !== gate.stepId,
			),
		);
		void queryClient.invalidateQueries({ queryKey: gateQueries.all() });
		void queryClient.invalidateQueries({ queryKey: runQueries.all() });
	}

	const resolve = useMutation(
		mutations.resolve({
			onSuccess: (_done, input) => {
				onSent();
				confirmAnswer({ choice: input.choice, runTitle: gate.runTitle });
				goBack();
				dropGate();
			},
			onError: (error) => {
				if (isGateClosed(error)) {
					onClosed();
					dropGate();
					return;
				}
				setProblem({ kind: "failed", message: error.message });
			},
		}),
	);

	const busy = checking !== null || resolve.isPending;

	async function answer(choice: string) {
		if (busy) return;
		setProblem(null);
		setChecking(choice);
		const failure = await checkBeforeAnswer(gate).finally(() =>
			setChecking(null),
		);
		if (failure) {
			setProblem({ kind: "check", failure });
			return;
		}
		const trimmed = note.trim();
		resolve.mutate({
			runId: gate.runId,
			stepId: gate.stepId,
			choice,
			note: trimmed === "" ? undefined : trimmed,
		});
	}

	const elsewhere = !gate.walker.thisDevice && gate.walker.name;

	return (
		<Screen>
			<View className="gap-3">
				<View className="flex-row flex-wrap items-center gap-2">
					<Badge variant="secondary">
						<Text>{gate.spaceName}</Text>
					</Badge>
					<Text variant="muted" className="text-muted-foreground text-xs">
						Waiting {waitedText(now - gate.openedAt)}
					</Text>
				</View>
				<Text variant="large" selectable>
					{headline}
				</Text>
				<Text variant="muted">
					{gate.projectName} · {gate.runTitle}
				</Text>
			</View>

			{context.length > 0 ? (
				<Card className="gap-4 py-4">
					<CardContent className="gap-4 px-4">
						{context.map((item, index) => (
							<ContextBlock key={index} item={item} />
						))}
					</CardContent>
				</Card>
			) : null}

			{links.length > 0 ? <LinkList links={links} /> : null}

			{gate.answerPending ? (
				<Alert icon={CircleCheck}>
					<AlertTitle>Someone already answered this Gate</AlertTitle>
					<AlertDescription>
						{elsewhere
							? `The run goes on when ${gate.walker.name} is online.`
							: "The run goes on in a moment."}
					</AlertDescription>
				</Alert>
			) : !gate.canAnswer ? (
				<Alert icon={Eye}>
					<AlertTitle>You cannot answer this Gate</AlertTitle>
					<AlertDescription>
						{`Your role in ${gate.spaceName} lets you read Gates, not answer them. Ask an owner or admin of the Space for another role.`}
					</AlertDescription>
				</Alert>
			) : (
				<Card className="gap-4 py-4">
					<CardHeader className="px-4">
						<CardTitle>Your answer</CardTitle>
						<CardDescription>
							{gate.lockScreen
								? "Choose an option. The run goes on with it."
								: "Choose an option. Your phone checks that it is you before Night Shift sends it."}
						</CardDescription>
					</CardHeader>
					<CardContent className="gap-4 px-4">
						<View className="gap-2">
							<Label nativeID="gate-note">Note (optional)</Label>
							<Textarea
								aria-labelledby="gate-note"
								value={note}
								onChangeText={setNote}
								placeholder="Context for the next steps"
								editable={!busy}
								numberOfLines={4}
							/>
							<Text variant="muted" className="text-muted-foreground text-xs">
								The next steps of the run get your note.
							</Text>
						</View>
						<Separator />
						{gate.choices.map((choice) => (
							<View key={choice.name} className="gap-1">
								<Button
									variant="outline"
									disabled={busy}
									onPress={() => void answer(choice.name)}
									accessibilityHint={choice.description}
								>
									{gate.lockScreen ? null : <Icon as={Fingerprint} />}
									<Text>
										{checking === choice.name
											? "Checking that it is you…"
											: resolve.isPending &&
													resolve.variables?.choice === choice.name
												? "Sending…"
												: choice.name}
									</Text>
								</Button>
								{choice.description ? (
									<Text
										variant="muted"
										className="px-1 text-muted-foreground text-xs"
									>
										{choice.description}
									</Text>
								) : null}
							</View>
						))}
						{elsewhere ? (
							<Text variant="muted" className="text-muted-foreground text-xs">
								{`Your answer goes to ${gate.walker.name}. The run goes on when ${gate.walker.name} is online.`}
							</Text>
						) : null}
						{problem ? <ProblemAlert problem={problem} /> : null}
					</CardContent>
				</Card>
			)}
		</Screen>
	);
}

function ProblemAlert({ problem }: { problem: Problem }) {
	const copy =
		problem.kind === "check"
			? CHECK_COPY[problem.failure]
			: {
					title: "Your answer was not sent",
					description: `${problem.message} Check that this phone is online. Then answer again.`,
				};
	return (
		<Alert icon={CircleAlert} variant="destructive">
			<AlertTitle>{copy.title}</AlertTitle>
			<AlertDescription>{copy.description}</AlertDescription>
		</Alert>
	);
}

/** A piece of the Gate's context: text, or code that scrolls sideways. */
function ContextBlock({ item }: { item: ContextItem }) {
	return (
		<View className="gap-1">
			{item.label ? (
				<Text variant="small" className="text-muted-foreground">
					{item.label}
				</Text>
			) : null}
			{item.kind === "code" ? (
				<ScrollView horizontal className="rounded-md bg-muted">
					<Text selectable className="p-3 font-mono text-xs">
						{item.value}
					</Text>
				</ScrollView>
			) : (
				<Text selectable className="text-sm">
					{item.value}
				</Text>
			)}
		</View>
	);
}

/** The links in the question: a pull request, a ticket, a page to check first. */
function LinkList({ links }: { links: GateLink[] }) {
	return (
		<View className="gap-2">
			<Text variant="small">Check before you answer</Text>
			{links.map((link) => (
				<Button
					key={link.url}
					variant="outline"
					className="justify-between"
					onPress={() => void WebBrowser.openBrowserAsync(link.url)}
					accessibilityHint="Opens the page in the browser"
				>
					<Text numberOfLines={1} className="flex-1">
						{link.label} · {link.short}
					</Text>
					<Icon as={ExternalLink} />
				</Button>
			))}
		</View>
	);
}
