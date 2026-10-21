import type { DashboardSummary } from "@nightshift/client";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@nightshift/ui-native/components/ui/card";
import { Progress } from "@nightshift/ui-native/components/ui/progress";
import { Skeleton } from "@nightshift/ui-native/components/ui/skeleton";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { cn } from "@nightshift/ui-native/lib/utils";
import { Link } from "expo-router";
import { Pressable, View } from "react-native";

import { type StatCardView, statCards } from "./cards";

/** Where a card goes when the person taps it. */
const HREF = { inbox: "/", runs: "/runs" } as const;

const TONE = {
	plain: "",
	waiting: "text-status-waiting",
	failed: "text-status-failed",
} as const;

/**
 * The four numbers on top, two by two: running now, waiting for you, and
 * the spend and the runs of the last 24 hours. Skeletons while they load.
 */
export function StatCards({
	summary,
	waiting,
}: {
	/** Undefined while it loads. */
	summary: DashboardSummary | undefined;
	/** The open Gates: null when they did not load. */
	waiting: number | null;
}) {
	const cards = summary ? statCards(summary, waiting) : null;
	const rows = cards ? [cards.slice(0, 2), cards.slice(2, 4)] : [null, null];
	return (
		<View className="gap-3">
			{rows.map((row, index) => (
				// Two rows of two: the order of the cards never changes.
				<View key={index} className="flex-row gap-3">
					{row ? (
						row.map((card) => <StatCard key={card.key} card={card} />)
					) : (
						<>
							<Skeleton className="h-36 flex-1 rounded-xl" />
							<Skeleton className="h-36 flex-1 rounded-xl" />
						</>
					)}
				</View>
			))}
		</View>
	);
}

function StatCard({ card }: { card: StatCardView }) {
	const body = (
		<Card
			className={cn(
				"flex-1 gap-3 py-4",
				card.tone === "waiting" && "border-status-waiting/50",
			)}
		>
			<CardHeader className="gap-1 px-4">
				<CardDescription className="text-xs">{card.label}</CardDescription>
				<CardTitle className={cn("text-2xl tabular-nums", TONE[card.tone])}>
					{card.value}
				</CardTitle>
			</CardHeader>
			{card.finishedShare !== null ? (
				<CardContent className="px-4">
					<Progress
						value={card.finishedShare}
						accessibilityLabel={`${card.finishedShare}% finished`}
						className="h-1.5 bg-muted"
						indicatorClassName="bg-status-finished"
					/>
				</CardContent>
			) : null}
			<CardFooter className="mt-auto flex-col items-start gap-1 px-4">
				<Text className="font-medium text-sm" numberOfLines={2}>
					{card.headline}
				</Text>
				<Text variant="muted" className="text-xs" numberOfLines={2}>
					{card.footer}
				</Text>
			</CardFooter>
		</Card>
	);
	if (!card.opens) return body;
	return (
		<Link href={HREF[card.opens]} asChild>
			<Pressable
				className="flex-1 active:opacity-70"
				accessibilityRole="button"
				accessibilityHint={
					card.opens === "inbox" ? "Opens the inbox" : "Opens your runs"
				}
			>
				{body}
			</Pressable>
		</Link>
	);
}
