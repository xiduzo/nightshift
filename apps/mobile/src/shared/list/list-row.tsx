import { Icon } from "@nightshift/ui-native/components/ui/icon";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { cn } from "@nightshift/ui-native/lib/utils";
import { type Href, Link } from "expo-router";
import { ChevronRight, type LucideIcon } from "lucide-react-native";
import { Fragment, type ReactNode } from "react";
import { Pressable, View } from "react-native";

import { iconOf } from "@/shared/status";
import { type Look, TONE_CLASS, type Tone } from "@/shared/tone";
import { type Caption, captionParts, partText, rowLabel } from "./caption";

export type ListRowProps = {
	/** The main line. */
	title: string;
	/** How many lines the title may take. */
	titleLines?: number;
	/** A small muted line above the title: "website · Feature factory". */
	overline?: string;
	/** A muted line under the title. Parts show split by " · ". */
	caption?: Caption;
	/** A second muted line under the caption. */
	detail?: Caption;
	/** The leading icon: muted, or in the tone's color. */
	icon?: LucideIcon;
	tone?: Tone;
	/** A status as the leading icon: its icon, tone and (spoken) word. */
	look?: Look;
	/** What the icon means, for a screen reader: "Needs you". */
	iconLabel?: string;
	/** Something else in front: an avatar. Wins over `icon` and `look`. */
	leading?: ReactNode;
	/** A short value at the end: "12 min", "09:41", "3". */
	value?: string;
	/** The value as a screen reader says it: "waited 12 min". */
	valueLabel?: string;
	/** Opens a screen. */
	href?: Href;
	onPress?: () => void;
	/** The chevron at the end. On by default when the row opens something. */
	chevron?: boolean;
	/** The whole row as one sentence, when the parts do not say it well. */
	accessibilityLabel?: string;
	/** What a tap does: "Opens the Gate". */
	accessibilityHint?: string;
	disabled?: boolean;
};

/**
 * One row of a ListGroup: a leading icon, a title, one or two caption
 * lines, a value and a chevron. The whole row is one element for a screen
 * reader, and one target of at least 44 pt.
 */
export function ListRow({
	title,
	titleLines = 2,
	overline,
	caption,
	detail,
	icon,
	tone,
	look,
	iconLabel,
	leading,
	value,
	valueLabel,
	href,
	onPress,
	chevron,
	accessibilityLabel,
	accessibilityHint,
	disabled,
}: ListRowProps) {
	const opens = href !== undefined || onPress !== undefined;
	const leadIcon = icon ?? (look ? iconOf(look.icon) : undefined);
	const leadTone = tone ?? look?.tone ?? "neutral";
	const label =
		accessibilityLabel ??
		rowLabel({
			iconLabel: iconLabel ?? look?.label,
			title,
			overline,
			caption,
			detail,
			value,
			valueLabel,
		});

	const body = (
		<View className="min-h-14 flex-row items-center gap-3 px-4 py-3">
			{leading ? (
				leading
			) : leadIcon ? (
				<View className="size-8 items-center justify-center">
					<Icon
						as={leadIcon}
						className={cn("size-5", TONE_CLASS[leadTone].text)}
					/>
				</View>
			) : null}
			<View className="flex-1 gap-0.5">
				{overline ? (
					<Text className="text-muted-foreground text-xs" numberOfLines={1}>
						{overline}
					</Text>
				) : null}
				<Text className="font-medium text-base" numberOfLines={titleLines}>
					{title}
				</Text>
				<CaptionLine caption={caption} />
				<CaptionLine caption={detail} />
			</View>
			{value ? (
				<Text className="text-muted-foreground text-sm tabular-nums">
					{value}
				</Text>
			) : null}
			{(chevron ?? opens) ? (
				<Icon as={ChevronRight} className="size-4 text-muted-foreground" />
			) : null}
		</View>
	);

	if (!opens) {
		return (
			<View accessible accessibilityLabel={label}>
				{body}
			</View>
		);
	}
	const row = (
		<Pressable
			onPress={onPress}
			disabled={disabled}
			accessibilityRole="button"
			accessibilityLabel={label}
			accessibilityHint={accessibilityHint}
			accessibilityState={{ disabled }}
			className="active:bg-accent"
		>
			{body}
		</Pressable>
	);
	return href !== undefined ? (
		<Link href={href} asChild>
			{row}
		</Link>
	) : (
		row
	);
}

function CaptionLine({ caption }: { caption: Caption | undefined }) {
	const parts = captionParts(caption);
	if (parts.length === 0) return null;
	return (
		<Text className="text-muted-foreground text-sm" numberOfLines={1}>
			{parts.map((part, index) => (
				<Fragment key={index}>
					{index > 0 ? " · " : null}
					{typeof part === "string" ? (
						part
					) : (
						<Text
							className={cn(
								"text-muted-foreground text-sm",
								part.mono && "font-mono",
								part.tone && cn("font-medium", TONE_CLASS[part.tone].text),
							)}
						>
							{partText(part)}
						</Text>
					)}
				</Fragment>
			))}
		</Text>
	);
}
