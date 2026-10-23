import { Badge } from "@nightshift/ui-native/components/ui/badge";
import { Icon } from "@nightshift/ui-native/components/ui/icon";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { cn } from "@nightshift/ui-native/lib/utils";
import { View } from "react-native";
import { type Look, TONE_CLASS } from "@/shared/tone";
import { iconOf } from "./icons";

/**
 * A status as an outline Badge: its icon and its word in the tone's color,
 * on a light tint of it. The web's run status badge. A neutral look is a
 * plain outline Badge.
 */
export function StatusBadge({
	look,
	className,
}: {
	look: Look;
	className?: string;
}) {
	const tone = TONE_CLASS[look.tone];
	return (
		<Badge variant="outline" className={cn(tone.badge, className)}>
			<Icon as={iconOf(look.icon)} className={cn("size-3", tone.text)} />
			<Text className={tone.text} numberOfLines={1}>
				{look.label}
			</Text>
		</Badge>
	);
}

/**
 * A status as an icon and a word in the tone's color, without a badge:
 * for a line of text ("Running · website · build") or a fact tile.
 */
export function StatusText({
	look,
	className,
}: {
	look: Look;
	className?: string;
}) {
	const tone = TONE_CLASS[look.tone];
	return (
		<View className={cn("flex-row items-center gap-1", className)}>
			<Icon as={iconOf(look.icon)} className={cn("size-3.5", tone.text)} />
			<Text className={cn("font-medium text-sm", tone.text)} numberOfLines={1}>
				{look.label}
			</Text>
		</View>
	);
}
