import {
	createDashboardQueries,
	createDeviceQueries,
	createGateQueries,
} from "@nightshift/client";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui-native/components/ui/alert";
import { Button } from "@nightshift/ui-native/components/ui/button";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { useQuery } from "@tanstack/react-query";
import { Link } from "expo-router";
import { CircleAlert, LayoutDashboard } from "lucide-react-native";

import { ComputersCard } from "@/features/devices";
import { useHostQueries } from "@/features/host";
import { EmptyState } from "@/shared/empty";
import { Screen } from "@/shared/page";
import { useScreenRefresh } from "@/shared/refresh";
import { hasRuns } from "./cards";
import { healthOf } from "./health";
import { RecentRuns } from "./recent-runs";
import { RunHealth } from "./run-health";
import { StatCards } from "./stat-cards";

/**
 * Tonight over every Space the person is in: the numbers of the web
 * dashboard, the newest runs, how each project did, and the computers
 * that can run a flow. It reads them again when the person comes back to
 * the tab, when they pull down, and once a minute.
 */
export function DashboardScreen() {
	const dashboard = useHostQueries(createDashboardQueries);
	const gates = useHostQueries(createGateQueries);
	const devices = useHostQueries(createDeviceQueries);

	const summary = useQuery(dashboard.summary({ everySpace: true }, "minute"));
	const open = useQuery(gates.open());
	const computers = useQuery(devices.overview());
	const refresh = useScreenRefresh([
		summary.refetch,
		open.refetch,
		computers.refetch,
	]);

	const now = summary.data?.at ?? Date.now();
	const health = summary.data ? healthOf(summary.data) : null;
	const empty = summary.data !== undefined && !hasRuns(summary.data);

	return (
		<Screen onRefresh={refresh}>
			{summary.error && !summary.data ? (
				<Alert icon={CircleAlert} variant="destructive">
					<AlertTitle>The dashboard did not load</AlertTitle>
					<AlertDescription>
						Check that this phone is online, then try again.
					</AlertDescription>
					<Button
						variant="outline"
						size="sm"
						className="mt-2 self-start"
						onPress={() => void refresh()}
					>
						<Text>Try again</Text>
					</Button>
				</Alert>
			) : empty ? (
				<EmptyState
					icon={LayoutDashboard}
					title="No runs yet"
					description="Here you see what your flows do and what they cost, over every Space you are in. Start a flow to see its first numbers."
				>
					<Link href="/start" asChild>
						<Button>
							<Text>Start a flow</Text>
						</Button>
					</Link>
				</EmptyState>
			) : (
				<>
					<Text className="text-muted-foreground text-sm">
						What runs, what waits for you, and what it cost, over every Space
						you are in.
					</Text>
					<StatCards
						summary={summary.data}
						waiting={open.data ? open.data.length : null}
					/>
					<RecentRuns runs={summary.data?.recent} now={now} />
					{health ? <RunHealth health={health} now={now} /> : null}
				</>
			)}
			<ComputersCard
				overview={computers.data}
				error={computers.error}
				now={now}
			/>
		</Screen>
	);
}
