import {
	createDashboardQueries,
	createGateQueries,
	inboxOrder,
	type OpenGate,
	waitingForYou,
} from "@nightshift/client";
import { Button } from "@nightshift/ui-native/components/ui/button";
import { Skeleton } from "@nightshift/ui-native/components/ui/skeleton";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { useQuery } from "@tanstack/react-query";
import { type Href, Link } from "expo-router";
import {
	CircleCheck,
	FolderGit2,
	History,
	Laptop,
	Moon,
	MoonStar,
	Plus,
	Search,
	Settings,
	Workflow,
} from "lucide-react-native";
import type { ReactNode } from "react";
import { View } from "react-native";

import { useHostQueries, useSignedIn } from "@/features/host";
import { GateRow } from "@/features/inbox";
import { EmptyState } from "@/shared/empty";
import { ErrorAlert } from "@/shared/feedback";
import { AvatarButton, HeaderButton, LargeTitleHeader } from "@/shared/header";
import { ListGroup, ListRow, SectionHead } from "@/shared/list";
import { Screen } from "@/shared/page";
import { useScreenRefresh } from "@/shared/refresh";
import { NightRunRow } from "./home-rows";
import {
	endedCount,
	needsYou,
	needsYouHint,
	nightLine,
	nightNumbers,
	nightOutput,
	runningHint,
	runningNow,
} from "./last-night";
import { NightTiles } from "./night-tiles";

/** The Runs tab, showing only the runs on their way. */
const RUNNING_RUNS: Href = { pathname: "/runs", params: { filter: "running" } };

/**
 * Home: what happened last night over every Space you are in, what needs
 * you, what runs now, and the way to the rest of your work. The avatar
 * opens Settings, + starts a run, the magnifier searches.
 */
export function HomeScreen() {
	const { person } = useSignedIn();
	const dashboard = useHostQueries(createDashboardQueries);
	const gateQueries = useHostQueries(createGateQueries);
	const summary = useQuery(dashboard.summary({ everySpace: true }));
	const gates = useQuery({
		...gateQueries.open(),
		select: (open: OpenGate[]) => inboxOrder(open),
	});
	const refresh = useScreenRefresh([summary.refetch, gates.refetch]);

	const now = Date.now();
	const data = summary.data;
	const noRuns = data !== undefined && data.lastNight === null;
	const waiting = gates.data
		? waitingForYou(gates.data)
		: gates.isError
			? null
			: undefined;

	return (
		<Screen onRefresh={refresh}>
			<LargeTitleHeader
				title="Last night"
				summary={
					data?.lastNight
						? nightLine(data.lastNight)
						: noRuns
							? "No runs yet"
							: undefined
				}
				leading={
					<AvatarButton
						name={person.name}
						label="Settings"
						hint={`Signed in as ${person.name}`}
						href="/settings"
					/>
				}
				actions={
					<>
						<HeaderButton icon={Plus} label="New run" href="/start" />
						<HeaderButton icon={Search} label="Search" href="/search" />
					</>
				}
			/>

			{summary.isError && !data ? (
				<ErrorAlert
					title="Last night did not load"
					message={summary.error.message}
					fix="Check that this phone is online, then try again."
					onRetry={() => void summary.refetch()}
				/>
			) : noRuns ? (
				<EmptyState
					icon={MoonStar}
					title="No runs yet"
					description="Start a flow tonight. In the morning you see here what it did and what it cost."
				>
					<Link href="/start" asChild>
						<Button size="lg" className="h-auto min-h-11 py-2">
							<Text>New run</Text>
						</Button>
					</Link>
				</EmptyState>
			) : (
				<NightTiles
					numbers={data ? (nightNumbers(data) ?? undefined) : undefined}
					waiting={waiting}
				/>
			)}

			<NeedsYouSection gates={gates} now={now} />

			{data && !noRuns ? (
				<>
					<RunningSection
						runs={runningNow(data)}
						count={data.open.running}
						now={now}
					/>
					<NightOutputSection
						runs={nightOutput(data)}
						ended={endedCount(data)}
						now={now}
					/>
				</>
			) : !data && !summary.isError ? (
				<Skeleton className="h-32 w-full rounded-xl" />
			) : null}

			<Section>
				<SectionHead title="Your work" />
				<ListGroup>
					<ListRow icon={History} title="Runs" href="/runs" />
					<ListRow
						icon={Workflow}
						title="Flows"
						caption="How often their runs finish"
						href="/flows"
					/>
					<ListRow icon={FolderGit2} title="Projects" href="/projects" />
					<ListRow
						icon={Laptop}
						title="Computers"
						caption="Where your flows run"
						href="/computers"
					/>
					<ListRow icon={Settings} title="Settings" href="/settings" />
				</ListGroup>
			</Section>
		</Screen>
	);
}

/** A section of Home: a little more room above it than between its parts. */
function Section({ children }: { children: ReactNode }) {
	return <View className="mt-4 gap-3">{children}</View>;
}

function NeedsYouSection({
	gates,
	now,
}: {
	gates: {
		data: OpenGate[] | undefined;
		isError: boolean;
		error: Error | null;
		refetch: () => Promise<unknown>;
	};
	now: number;
}) {
	const open = gates.data ? waitingForYou(gates.data) : 0;
	const shown = gates.data ? needsYou(gates.data) : [];
	return (
		<Section>
			<SectionHead
				title="Needs you"
				hint={gates.data ? needsYouHint(open) : undefined}
				seeAll={open > 0 ? { href: "/inbox" } : undefined}
			/>
			{gates.data ? (
				shown.length > 0 ? (
					<ListGroup>
						{shown.map((gate) => (
							<GateRow
								key={`${gate.runId}:${gate.stepId}`}
								gate={gate}
								now={now}
							/>
						))}
					</ListGroup>
				) : (
					<ListGroup>
						<ListRow
							icon={CircleCheck}
							title="Nothing needs you"
							caption="When a run waits for your answer, it shows here."
						/>
					</ListGroup>
				)
			) : gates.isError ? (
				<ErrorAlert
					title="Your Gates did not load"
					message={gates.error?.message ?? ""}
					fix="Check that this phone is online, then try again."
					onRetry={() => void gates.refetch()}
				/>
			) : (
				<Skeleton className="h-24 w-full rounded-xl" />
			)}
		</Section>
	);
}

function RunningSection({
	runs,
	count,
	now,
}: {
	runs: ReturnType<typeof runningNow>;
	/** Every running run, also the ones the summary does not list. */
	count: number;
	now: number;
}) {
	return (
		<Section>
			<SectionHead
				title="Running now"
				hint={runningHint(count)}
				seeAll={count > 0 ? { href: RUNNING_RUNS } : undefined}
			/>
			{runs.length > 0 ? (
				<ListGroup>
					{runs.map((run) => (
						<NightRunRow key={run.id} run={run} now={now} />
					))}
				</ListGroup>
			) : count > 0 ? (
				<ListGroup>
					<ListRow
						icon={History}
						title={
							count === 1 ? "1 run is at work" : `${count} runs are at work`
						}
						caption="See them on the Runs tab."
						href={RUNNING_RUNS}
					/>
				</ListGroup>
			) : (
				<ListGroup>
					<ListRow
						icon={Moon}
						title="Nothing runs right now"
						caption="Tap + to start a run."
					/>
				</ListGroup>
			)}
		</Section>
	);
}

function NightOutputSection({
	runs,
	ended,
	now,
}: {
	runs: ReturnType<typeof nightOutput>;
	/** Every run of the night that ended, also the ones the summary does not list. */
	ended: number | null;
	now: number;
}) {
	return (
		<Section>
			<SectionHead
				title="Ended last night"
				hint={ended ? `Newest first · ${ended} ended` : "Newest first"}
				seeAll={{ href: "/runs" }}
			/>
			{runs.length > 0 ? (
				<ListGroup>
					{runs.map((run) => (
						<NightRunRow key={run.id} run={run} now={now} />
					))}
				</ListGroup>
			) : ended ? (
				<ListGroup>
					<ListRow
						icon={History}
						title={ended === 1 ? "1 run ended" : `${ended} runs ended`}
						caption="See them on the Runs tab."
						href="/runs"
					/>
				</ListGroup>
			) : (
				<ListGroup>
					<ListRow
						icon={Moon}
						title="No run ended yet"
						caption="A run shows here when it finishes, fails or stops."
					/>
				</ListGroup>
			)}
		</Section>
	);
}
