import {
	createProjectQueries,
	gateRefusalText,
	gateRun,
	type OpenGate,
	type RunSummary,
} from "@nightshift/client";
import { Skeleton } from "@nightshift/ui-native/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import {
	CircleCheck,
	EyeOff,
	Inbox,
	Info,
	SkipForward,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";

import { useHostQueries, useSignedIn } from "@/features/host";
import { PushCard } from "@/features/push";
import { EmptyState } from "@/shared/empty";
import { ErrorSection } from "@/shared/feedback";
import { type HeaderItem, TabRootHeader } from "@/shared/header";
import {
	NativeCustomRow,
	type NativeIcon,
	NativeList,
	NativeSection,
	NativeTextRow,
} from "@/shared/native-list";
import { useScreenRefresh, useWhileFocused } from "@/shared/refresh";
import { useThemeColors } from "@/shared/theme";
import type { AnswerBar, GateQueue } from "../answer";
import { GateBriefing, type GateSent } from "../briefing";
import {
	FOCUS_START,
	type FocusState,
	focusView,
	handle,
	release,
	skip,
} from "./focus";
import { leaveRun } from "./left-runs";
import { type NeedsItem, runItem } from "./queue";
import { retryState } from "./retry";
import { RunBriefing } from "./run-briefing";
import { useNeedsYou } from "./use-needs";
import { needsBar } from "./use-needs-accessory";
import { useRetryRuns } from "./use-retry";

/** How long a notice stays: what went, or what left the queue. */
const NOTICE_MS = 10_000;

/** What just happened, at the top: what you sent, or what left the queue. */
type Notice = {
	kind: "sent" | "info" | "left";
	title: string;
	description: string;
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

const NOTICE_ICON: Record<Notice["kind"], NativeIcon> = {
	sent: { sf: "checkmark.circle.fill", lucide: CircleCheck },
	info: { sf: "info.circle", lucide: Info },
	left: { sf: "eye.slash", lucide: EyeOff },
};

const ONLINE_FIX =
	"Check that this phone is online. Then pull down or try again.";

function nothing() {}

/** Where the thing is from, for the bar above the tabs: the flow of a Gate, the title of a run. */
function fromOf(item: NeedsItem): string {
	return item.kind === "gate" ? gateRun(item.gate).flow : item.run.title;
}

/**
 * The Needs you tab: one thing that waits for you at a time, in full,
 * so you know all of it before you decide, as a native grouped list.
 * The Gates you may answer in queue order, then the runs that stopped in
 * the last day. Skip sits in the header. The bar above the tabs shows
 * where you are in the queue and sends the option you chose. The thing
 * you read stays while new Gates arrive. After you answer, the next one
 * shows with a short notice of what went.
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

	// Nothing on screen: the bar above the tabs shows only the count.
	useEffect(() => {
		if (!current) needsBar.set(null, nothing);
	}, [current]);

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
		});
	}, []);

	const lead = (
		<>
			{notice ? <NoticeSection notice={notice} /> : null}
			{needs.gatesError ? (
				<ErrorSection
					title="Your Gates did not load"
					message={needs.gatesError.message}
					fix={ONLINE_FIX}
					onRetry={() => void needs.refetch()}
				/>
			) : null}
			{needs.runsError ? (
				<ErrorSection
					title="The runs that stopped did not load"
					message={needs.runsError.message}
					fix={ONLINE_FIX}
					onRetry={() => void needs.refetch()}
				/>
			) : null}
			{retry.failure ? (
				<ErrorSection
					title={retry.failure.title}
					message={retry.failure.message}
					fix="Check that this phone is online and that your role in this Space lets you do this."
				/>
			) : null}
		</>
	);

	const header = <TabRootHeader name={person.name} />;

	if (current) {
		const right: HeaderItem[] =
			view.total > 1
				? [
						{
							kind: "button",
							key: "skip",
							label: "Skip",
							hint: "Moves this to the end. You see it again later.",
							text: "Skip",
							sf: "forward.end",
							icon: SkipForward,
							onPress: () => setFocus((state) => skip(state, current.key)),
						},
					]
				: [];
		const queue: GateQueue = {
			lead,
			right,
			onBar: (bar: AnswerBar | null, send: () => void) =>
				needsBar.set(
					bar
						? {
								...bar,
								position: view.position,
								total: view.total,
								from: fromOf(current),
							}
						: null,
					send,
				),
		};

		if (current.kind === "gate") {
			const item = current;
			return (
				<>
					{header}
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
						queue={queue}
					/>
				</>
			);
		}

		const { run } = current;
		return (
			<>
				{header}
				<RunBriefing
					key={current.key}
					run={run}
					projectName={projectNames.get(run.projectId) ?? null}
					retry={retryState(run, retry.sends)}
					onRetry={retry.onRetry}
					onRetried={onRetried}
					onLeave={onLeave}
					onRefresh={refresh}
					queue={queue}
				/>
			</>
		);
	}

	const empty = !needs.loading && !needs.gatesError && !needs.runsError;
	return (
		<>
			{header}
			<NativeList onRefresh={refresh}>
				{lead}
				{needs.loading ? (
					<NativeSection>
						<NativeCustomRow>
							<View className="gap-3">
								<Skeleton className="h-6 w-1/3 rounded-md" />
								<Skeleton className="h-24 w-full rounded-xl" />
							</View>
						</NativeCustomRow>
					</NativeSection>
				) : empty ? (
					<NativeSection>
						<NativeCustomRow>
							<View className="gap-4">
								<EmptyState
									icon={Inbox}
									title="Nothing needs you"
									description="When a Gate waits for you or a run stops, it shows here."
								/>
								<PushCard />
							</View>
						</NativeCustomRow>
					</NativeSection>
				) : null}
			</NativeList>
		</>
	);
}

/** What just happened: what went, or what left the queue. */
function NoticeSection({ notice }: { notice: Notice }) {
	const { colors } = useThemeColors();
	return (
		<NativeSection>
			<NativeTextRow
				icon={NOTICE_ICON[notice.kind]}
				iconColor={notice.kind === "sent" ? colors.statusFinished : undefined}
				text={`**${notice.title}**`}
				note={notice.description}
			/>
		</NativeSection>
	);
}
