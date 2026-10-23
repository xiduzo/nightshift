import { agoLabel, createDeviceQueries } from "@nightshift/client";
import { Skeleton } from "@nightshift/ui-native/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Laptop, Server } from "lucide-react-native";

import { useHostQueries } from "@/features/host";
import { EmptyState } from "@/shared/empty";
import { ErrorAlert } from "@/shared/feedback";
import { LargeTitleHeader } from "@/shared/header";
import { ListGroup, ListRow } from "@/shared/list";
import { Screen } from "@/shared/page";
import { type Computer, computersOf, onlineSummary } from "./computers";

/** Your computers and whether each can run a flow now. A sheet from Home. */
export function ComputersScreen() {
	const devices = useHostQueries(createDeviceQueries);
	const overview = useQuery(devices.overview());
	const computers = overview.data ? computersOf(overview.data) : undefined;
	const now = overview.dataUpdatedAt || Date.now();

	return (
		<Screen onRefresh={() => overview.refetch()}>
			<LargeTitleHeader
				compact
				title="Computers"
				summary={
					computers && computers.length > 0
						? onlineSummary(computers)
						: "A flow runs on a computer that is online."
				}
			/>
			{computers ? (
				computers.length === 0 ? (
					<EmptyState
						icon={Laptop}
						title="No computer yet"
						description="To run flows on a computer, open Devices in Night Shift on it and choose Join a Host."
					/>
				) : (
					<ListGroup>
						{computers.map((computer) => (
							<ComputerRow key={computer.id} computer={computer} now={now} />
						))}
					</ListGroup>
				)
			) : overview.isError ? (
				<ErrorAlert
					title="Your computers did not load"
					message={overview.error.message}
					fix="Check that this phone is online, then try again."
					onRetry={() => void overview.refetch()}
				/>
			) : (
				<Skeleton className="h-32 w-full rounded-xl" />
			)}
		</Screen>
	);
}

/** One computer: its name, system and whether it is online, or when it was last seen. */
function ComputerRow({ computer, now }: { computer: Computer; now: number }) {
	const seen = computer.isHost
		? "The Host this phone uses"
		: computer.online
			? null
			: computer.lastSeenAt
				? `Last seen ${agoLabel(computer.lastSeenAt, now)}`
				: "Not connected yet";
	return (
		<ListRow
			icon={computer.isHost ? Server : Laptop}
			tone={computer.online ? "finished" : "neutral"}
			title={computer.name}
			caption={[
				computer.online
					? { text: "Online", tone: "finished" }
					: { text: "Offline" },
				computer.system,
			]}
			detail={seen ?? undefined}
		/>
	);
}
