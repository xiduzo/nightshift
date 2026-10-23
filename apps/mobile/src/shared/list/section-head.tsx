import { Button } from "@nightshift/ui-native/components/ui/button";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { type Href, Link } from "expo-router";
import { View } from "react-native";

export type SectionHeadProps = {
	title: string;
	/** A muted line under the title: "Oldest first · 3 open". */
	hint?: string;
	/** "See all" on the right: opens the whole list. */
	seeAll?:
		| { href: Href; label?: string }
		| { onPress: () => void; label?: string };
};

/** The head of a section: its title, a muted hint, and "See all" on the right. */
export function SectionHead({ title, hint, seeAll }: SectionHeadProps) {
	const label = seeAll?.label ?? "See all";
	const button = seeAll ? (
		<Button
			variant="ghost"
			size="sm"
			className="-mr-2 h-11"
			onPress={"onPress" in seeAll ? seeAll.onPress : undefined}
			accessibilityLabel={`${label}, ${title}`}
		>
			<Text className="text-muted-foreground">{label}</Text>
		</Button>
	) : null;
	return (
		<View className="flex-row items-end gap-3">
			<View className="flex-1 gap-0.5">
				<Text
					accessibilityRole="header"
					className="font-semibold text-xl tracking-tight"
				>
					{title}
				</Text>
				{hint ? (
					<Text className="text-muted-foreground text-sm">{hint}</Text>
				) : null}
			</View>
			{seeAll && "href" in seeAll ? (
				<Link href={seeAll.href} asChild>
					{button}
				</Link>
			) : (
				button
			)}
		</View>
	);
}
