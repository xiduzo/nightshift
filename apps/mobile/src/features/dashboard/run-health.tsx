import { agoLabel } from "@nightshift/client";
import { Icon } from "@nightshift/ui-native/components/ui/icon";
import { Progress } from "@nightshift/ui-native/components/ui/progress";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { cn } from "@nightshift/ui-native/lib/utils";
import { Link } from "expo-router";
import { ChevronRight } from "lucide-react-native";
import { Pressable, View } from "react-native";

import { ListGroup, SectionHead } from "@/shared/list";
import { StatusText } from "@/shared/status";
import { runStatusLook } from "@/shared/tone";
import { type Health, type HealthRow, hiddenText } from "./health";

/**
 * How each flow (one project) or each project (every Space) did: the share
 * of runs that finished, as a bar and a number, in one card.
 */
export function RunHealth({ health, now }: { health: Health; now: number }) {
	const hidden = hiddenText(health.hidden);
	return (
		<View className="gap-3">
			<SectionHead title={health.title} hint={health.description} />
			<ListGroup>
				{health.rows.map((row) => (
					<HealthRowView key={row.key} row={row} now={now} />
				))}
			</ListGroup>
			{hidden ? (
				<Text className="text-muted-foreground text-xs">{hidden}</Text>
			) : null}
		</View>
	);
}

function HealthRowView({ row, now }: { row: HealthRow; now: number }) {
	const last = row.last;
	const look = last ? runStatusLook(last.status) : null;
	const lastText = last ? `Last run ${agoLabel(last.startedAt, now)}` : null;
	const share = row.share === null ? "No run ended" : `${row.share}% finished`;
	const label = [
		row.label,
		share,
		row.detail,
		row.more,
		row.offline,
		lastText,
		look?.label,
	]
		.filter(Boolean)
		.join(", ");

	const body = (
		<View className="gap-2 px-4 py-3">
			<View className="flex-row items-center gap-3">
				<Text
					className={cn(
						"min-w-0 flex-1 font-medium",
						row.mono ? "font-mono text-sm" : "text-base",
					)}
					numberOfLines={2}
				>
					{row.label}
				</Text>
				<Text className="text-sm tabular-nums">
					{row.share === null ? "—" : `${row.share}%`}
				</Text>
				{last ? (
					<Icon as={ChevronRight} className="size-4 text-muted-foreground" />
				) : null}
			</View>
			<Progress
				value={row.share ?? 0}
				className="h-1.5 bg-muted"
				// At 0 the rounded bar still draws a dot: hide it.
				indicatorClassName={cn("bg-status-finished", !row.share && "opacity-0")}
			/>
			<Text className="text-muted-foreground text-sm">{row.detail}</Text>
			{row.more ? (
				<Text className="text-muted-foreground text-sm">{row.more}</Text>
			) : null}
			{row.offline ? (
				<Text className="text-destructive text-sm">{row.offline}</Text>
			) : null}
			{last && look ? (
				<View className="flex-row flex-wrap items-center gap-x-2 gap-y-1">
					<StatusText look={look} />
					<Text className="text-muted-foreground text-sm">{lastText}</Text>
				</View>
			) : null}
		</View>
	);

	if (!last) {
		return (
			<View accessible accessibilityLabel={label}>
				{body}
			</View>
		);
	}
	return (
		<Link
			href={{ pathname: "/runs/[runId]", params: { runId: last.runId } }}
			asChild
		>
			<Pressable
				accessibilityRole="button"
				accessibilityLabel={label}
				accessibilityHint="Opens its last run"
				className="active:bg-accent"
			>
				{body}
			</Pressable>
		</Link>
	);
}
