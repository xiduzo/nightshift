import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@nightshift/ui-native/components/ui/card";
import { Progress } from "@nightshift/ui-native/components/ui/progress";
import { Separator } from "@nightshift/ui-native/components/ui/separator";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { Fragment } from "react";
import { View } from "react-native";

import { formatAgo } from "@/shared/format";
import type { Health, HealthRow } from "./health";
import { RunStatusBadge } from "./run-status-badge";

/**
 * How each flow (one project) or each project (every Space) did: the share
 * of runs that finished, as a bar and a number.
 */
export function RunHealth({ health, now }: { health: Health; now: number }) {
	return (
		<Card className="gap-4">
			<CardHeader>
				<CardTitle>{health.title}</CardTitle>
				<CardDescription>{health.description}</CardDescription>
			</CardHeader>
			<CardContent className="gap-3">
				{health.rows.map((row, index) => (
					<Fragment key={row.key}>
						{index > 0 ? <Separator /> : null}
						<HealthRowView row={row} now={now} />
					</Fragment>
				))}
				{health.more > 0 ? (
					<Text className="text-muted-foreground text-xs">
						{health.more === 1
							? "1 more is not shown."
							: `${health.more} more are not shown.`}
					</Text>
				) : null}
			</CardContent>
		</Card>
	);
}

function HealthRowView({ row, now }: { row: HealthRow; now: number }) {
	return (
		<View className="gap-2">
			<View className="flex-row items-center gap-3">
				<Text className="min-w-0 flex-1 font-medium" numberOfLines={1}>
					{row.label}
				</Text>
				<Text className="text-sm tabular-nums">
					{row.share === null ? "—" : `${row.share}%`}
				</Text>
			</View>
			<Progress
				value={row.share ?? 0}
				accessibilityLabel={
					row.share === null
						? `${row.label}: no run ended yet`
						: `${row.label}: ${row.share}% finished`
				}
				className="h-1.5 bg-muted"
				indicatorClassName="bg-status-finished"
			/>
			<View className="flex-row items-center gap-2">
				<Text
					className="flex-1 text-muted-foreground text-xs"
					numberOfLines={1}
				>
					{row.last
						? `${row.detail}. Last run ${formatAgo(row.last.startedAt, now)}.`
						: `${row.detail}.`}
				</Text>
				{row.last ? <RunStatusBadge status={row.last.status} /> : null}
			</View>
		</View>
	);
}
