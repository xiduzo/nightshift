import { agoLabel, type DevicesOverview } from "@nightshift/client";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui-native/components/ui/alert";
import { Badge } from "@nightshift/ui-native/components/ui/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@nightshift/ui-native/components/ui/card";
import { Icon } from "@nightshift/ui-native/components/ui/icon";
import { Separator } from "@nightshift/ui-native/components/ui/separator";
import { Skeleton } from "@nightshift/ui-native/components/ui/skeleton";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { CircleAlert, Laptop, Server } from "lucide-react-native";
import { Fragment } from "react";
import { View } from "react-native";

import { type Computer, computersOf } from "./computers";

/**
 * The person's computers and whether each is online, so they know where a
 * flow can run. The data comes from the screen that shows it, which also
 * reads it again.
 */
export function ComputersCard({
	overview,
	error,
	now,
}: {
	/** Undefined while it loads. */
	overview: DevicesOverview | undefined;
	error: Error | null;
	now: number;
}) {
	const computers = overview ? computersOf(overview) : undefined;
	return (
		<Card className="gap-4">
			<CardHeader>
				<CardTitle>Computers</CardTitle>
				<CardDescription>
					Your computers that run Night Shift. A flow runs on a computer that is
					online.
				</CardDescription>
			</CardHeader>
			<CardContent className="gap-3">
				{computers ? (
					computers.length === 0 ? (
						<Text className="text-muted-foreground text-sm">
							No computer yet. To run flows on one, open Devices in Night Shift
							on that computer and choose Join a Host.
						</Text>
					) : (
						computers.map((computer, index) => (
							<Fragment key={computer.id}>
								{index > 0 ? <Separator /> : null}
								<ComputerRow computer={computer} now={now} />
							</Fragment>
						))
					)
				) : error ? (
					<Alert icon={CircleAlert} variant="destructive">
						<AlertTitle>Your computers did not load</AlertTitle>
						<AlertDescription>
							Check that this phone is online, then pull down to try again.
						</AlertDescription>
					</Alert>
				) : (
					<>
						<Skeleton className="h-10 w-full" />
						<Skeleton className="h-10 w-full" />
					</>
				)}
			</CardContent>
		</Card>
	);
}

function ComputerRow({ computer, now }: { computer: Computer; now: number }) {
	const detail = computer.isHost
		? "The Host this phone uses"
		: computer.online
			? "Connected now"
			: computer.lastSeenAt
				? `Last seen ${agoLabel(computer.lastSeenAt, now)}`
				: "Not connected yet";
	return (
		<View className="flex-row items-center gap-3">
			<View className="size-9 items-center justify-center rounded-md bg-muted">
				<Icon
					as={computer.isHost ? Server : Laptop}
					className="size-4 text-muted-foreground"
				/>
			</View>
			<View className="min-w-0 flex-1 gap-0.5">
				<Text className="font-medium" numberOfLines={1}>
					{computer.name}
				</Text>
				<Text className="text-muted-foreground text-xs" numberOfLines={1}>
					{computer.system}. {detail}.
				</Text>
			</View>
			{computer.online ? (
				<Badge
					variant="outline"
					className="border-status-finished/40 bg-status-finished/10"
				>
					<Text className="text-status-finished">Online</Text>
				</Badge>
			) : (
				<Badge variant="outline">
					<Text className="text-muted-foreground">Offline</Text>
				</Badge>
			)}
		</View>
	);
}
