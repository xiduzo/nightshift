import { Card } from "@nightshift/ui-native/components/ui/card";
import { Icon } from "@nightshift/ui-native/components/ui/icon";
import { Skeleton } from "@nightshift/ui-native/components/ui/skeleton";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { cn } from "@nightshift/ui-native/lib/utils";
import { type Href, Link } from "expo-router";
import type { LucideIcon } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";

import { TONE_CLASS, type Tone } from "@/shared/tone";
import { TwoColumns } from "./two-columns";

type StatTileProps = {
	/** The number: "3", "$1.20". Undefined while it loads: a Skeleton. */
	value: string | undefined;
	/** What it counts: "Needs you". */
	label: string;
	icon: LucideIcon;
	/** Colors the icon and the caption. Neutral by default. */
	tone?: Tone;
	/** A short line under the number: "Gates need your answer". */
	caption?: string;
	/** A muted line under the caption. */
	detail?: string;
	href?: Href;
	onPress?: () => void;
	/** What a tap does: "Opens the inbox". */
	accessibilityHint?: string;
};

/**
 * One number of a StatGrid: an icon and a label, the big number, and an
 * optional caption. Like the stat cards of the web dashboard. A tap opens
 * the list behind the number.
 */
export function StatTile({
	value,
	label,
	icon,
	tone = "neutral",
	caption,
	detail,
	href,
	onPress,
	accessibilityHint,
}: StatTileProps) {
	const toneText = TONE_CLASS[tone].text;
	const spoken = [label, value ?? "loading", caption, detail]
		.filter(Boolean)
		.join(", ");
	const body = (
		<Card className="flex-1 gap-1 px-4 py-4">
			<View className="flex-row items-center gap-2">
				<Icon as={icon} className={cn("size-4", toneText)} />
				<Text
					className="flex-1 text-muted-foreground text-sm"
					numberOfLines={2}
				>
					{label}
				</Text>
			</View>
			{value === undefined ? (
				<Skeleton className="my-1 h-8 w-14" />
			) : (
				<Text
					className="font-semibold text-3xl tabular-nums"
					// A big number shrinks to fit rather than break: "$0.0 / 0".
					numberOfLines={1}
					adjustsFontSizeToFit
				>
					{value}
				</Text>
			)}
			{caption ? (
				<Text
					className={cn(
						"font-medium text-sm",
						tone === "neutral" ? "text-foreground" : toneText,
					)}
					numberOfLines={2}
				>
					{caption}
				</Text>
			) : null}
			{detail ? (
				<Text className="text-muted-foreground text-xs" numberOfLines={2}>
					{detail}
				</Text>
			) : null}
		</Card>
	);

	if (href === undefined && onPress === undefined) {
		return (
			<View accessible accessibilityLabel={spoken} className="flex-1">
				{body}
			</View>
		);
	}
	const tile = (
		<Pressable
			onPress={onPress}
			accessibilityRole="button"
			accessibilityLabel={spoken}
			accessibilityHint={accessibilityHint}
			className="flex-1 active:opacity-70"
		>
			{body}
		</Pressable>
	);
	return href !== undefined ? (
		<Link href={href} asChild>
			{tile}
		</Link>
	) : (
		tile
	);
}

/** StatTiles two by two: the numbers of "Last night". */
export function StatGrid({ children }: { children: ReactNode }) {
	return <TwoColumns>{children}</TwoColumns>;
}
