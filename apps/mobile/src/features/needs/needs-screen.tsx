import {
	createProjectQueries,
	gateRefusalText,
	type OpenGate,
	type RunSummary,
} from "@nightshift/client";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui-native/components/ui/alert";
import { Button } from "@nightshift/ui-native/components/ui/button";
import { Skeleton } from "@nightshift/ui-native/components/ui/skeleton";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { useQuery } from "@tanstack/react-query";
import { CircleCheck, Inbox, Info, Undo2 } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useHostQueries, useSignedIn } from "@/features/host";
import { GateBriefing, type GateSent } from "@/features/inbox";
import { PushCard } from "@/features/push";
import { leaveRun, unleaveRun } from "@/features/runs";
import { EmptyState } from "@/shared/empty";
import { ErrorAlert } from "@/shared/feedback";
import { TabRootHeader } from "@/shared/header";
import { Screen } from "@/shared/page";
import { useScreenRefresh, useWhileFocused } from "@/shared/refresh";
import {
	FOCUS_START,
	type FocusState,
	focusView,
	handle,
	release,
	skip,
} from "./focus";
import { type NeedsItem, runItem } from "./queue";
import { QueueBar } from "./queue-bar";
import { retryState } from "./retry";
import { RunBriefing } from "./run-briefing";
import { useNeedsYou } from "./use-needs";
import { useRetryRuns } from "./use-retry";

/** How long a notice stays: what went, or Undo after you leave a run. */
const NOTICE_MS = 10_000;

/** What just happened, at the top: what you sent, or what left the queue. */
type Notice = {
	kind: "sent" | "info" | "left";
	title: string;
	description: string;
	/** Puts a run you left back. */
	undo?: () => void;
};

/** Why the thing you read left the queue without you. */
const VANISHED: Record<NeedsItem["kind"], Omit<Notice, "kind">> = {
	gate: {
		title: "The Gate you read does not wait anymore",
		description: "Someone answered it, or its run ended.",
	},
	run: {
		title: "The run you read is off this list",
		description: "It continues, or it stopped more than a day ago.",
	},
};

const NOTICE_ICON = { sent: CircleCheck, info: Info, left: Undo2 } as const;

/**
 * The Needs you tab: one thing that waits for you at a time, in full,
 * so you know all of it before you decide. The Gates you may answer in
 * queue order, then the runs that stopped in the last day. On top, where
 * you are in the queue and Skip. The thing you read stays while new
 * Gates arrive. After you answer, the next one shows with a short notice
 * of what went.
 */
export function NeedsScreen() {
	const { person } = useSignedIn();
	const { subscribed } = useWhileFocused();
	const needs = useNeedsYou(subscribed);
	const projectQueries = useHostQueries(createProjectQueries);
	const projects = useQuery({ ...projectQueries.list(), subscribed });
	const refresh = useScreenRefresh([needs.refetch, projects.refetch]);
	const retry = useRetryRuns();
	const [focus, setFocus] = useState<FocusState>(FOCUS_START);
	const [notice, setNotice] = useState<Notice | null>(null);

	const view = focusView(focus, needs.items);
	if (view.settled) {
		// Keep the thing on screen pinned. Set while rendering: React renders again at once.
		setFocus(view.settled);
		if (view.vanished) setNotice({ kind: "info", ...VANISHED[view.vanished] });
	}
	const { current } = view;

	useEffect(() => {
		if (!notice) return;
		const timer = setTimeout(() => setNotice(null), NOTICE_MS);
		return () => clearTimeout(timer);
	}, [notice]);

	const projectNames = useMemo(
		() => new Map((projects.data ?? []).map((p) => [p.id, p.name])),
		[projects.data],
	);
	const gates = useMemo(
		() =>
			needs.items.flatMap((item): OpenGate[] =>
				item.kind === "gate" ? [item.gate] : [],
			),
		[needs.items],
	);

	const onRetried = useCallback((run: RunSummary, label: string) => {
		setFocus((state) => handle(state, runItem(run)));
		setNotice({
			kind: "sent",
			title: `Sent: ${label}`,
			description: "Night Shift continues this run.",
		});
	}, []);

	const onLeave = useCallback((run: RunSummary) => {
		setFocus(release);
		leaveRun(run.id);
		setNotice({
			kind: "left",
			title: `You left ${run.title}`,
			description: "It stays in Runs.",
			undo: () => unleaveRun(run.id),
		});
	}, []);

	const lead = (
		<>
			<TabRootHeader name={person.name} />
			{notice ? (
				<NoticeAlert notice={notice} onDone={() => setNotice(null)} />
			) : null}
			{needs.gatesError ? (
				<ErrorAlert
					title="Your Gates did not load"
					message={needs.gatesError.message}
					fix="Check that this phone is online. Then pull down or try again."
					onRetry={() => void needs.refetch()}
				/>
			) : null}
			{needs.runsError ? (
				<ErrorAlert
					title="The runs that stopped did not load"
					message={needs.runsError.message}
					fix="Check that this phone is online. Then pull down or try again."
					onRetry={() => void needs.refetch()}
				/>
			) : null}
			{retry.failure ? (
				<ErrorAlert
					title={retry.failure.title}
					message={retry.failure.message}
					fix="Check that this phone is online and that your role in this Space lets you do this."
				/>
			) : null}
			{current ? (
				<QueueBar
					position={view.position}
					total={view.total}
					onSkip={() => setFocus((state) => skip(state, current.key))}
				/>
			) : null}
		</>
	);

	if (current?.kind === "gate") {
		const item = current;
		return (
			<GateBriefing
				key={item.key}
				gate={item.gate}
				inbox={gates}
				onRefresh={refresh}
				onSent={(sent: GateSent) => {
					setFocus((state) => handle(state, item));
					setNotice({
						kind: "sent",
						title: `Signed off: ${sent.choice}`,
						description: sent.outcome,
					});
				}}
				onGone={(refusal) => {
					setFocus((state) => handle(state, item));
					setNotice({ kind: "info", ...gateRefusalText(refusal) });
				}}
				queue={{ lead }}
			/>
		);
	}

	if (current?.kind === "run") {
		const { run } = current;
		return (
			<RunBriefing
				key={current.key}
				run={run}
				projectName={projectNames.get(run.projectId) ?? null}
				retry={retryState(run, retry.sends)}
				onRetry={retry.onRetry}
				onRetried={onRetried}
				onLeave={onLeave}
				onRefresh={refresh}
				lead={lead}
			/>
		);
	}

	const empty = !needs.loading && !needs.gatesError && !needs.runsError;
	return (
		<Screen onRefresh={refresh}>
			{lead}
			{needs.loading ? (
				<>
					<Skeleton className="h-6 w-1/3 rounded-md" />
					<Skeleton className="h-32 w-full rounded-xl" />
					<Skeleton className="h-24 w-full rounded-xl" />
				</>
			) : empty ? (
				<>
					<EmptyState
						icon={Inbox}
						title="Nothing needs you"
						description="When a Gate waits for you or a run stops, it shows here."
					/>
					<PushCard />
				</>
			) : null}
		</Screen>
	);
}

/** What just happened: what went, what left the queue, or Undo of a run you left. */
function NoticeAlert({
	notice,
	onDone,
}: {
	notice: Notice;
	onDone: () => void;
}) {
	const { undo } = notice;
	return (
		<Alert icon={NOTICE_ICON[notice.kind]} accessibilityLiveRegion="polite">
			<AlertTitle>{notice.title}</AlertTitle>
			<AlertDescription>{notice.description}</AlertDescription>
			{undo ? (
				<Button
					variant="outline"
					size="sm"
					className="mt-2 h-auto min-h-11 self-start py-2"
					onPress={() => {
						undo();
						onDone();
					}}
					accessibilityHint="Puts the run back on this list"
				>
					<Text>Undo</Text>
				</Button>
			) : null}
		</Alert>
	);
}
