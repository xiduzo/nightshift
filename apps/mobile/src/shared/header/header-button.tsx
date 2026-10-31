import { Button } from "@nightshift/ui-native/components/ui/button";
import { Icon } from "@nightshift/ui-native/components/ui/icon";
import { type Href, Link } from "expo-router";
import type { LucideIcon } from "lucide-react-native";
import { Pressable } from "react-native";

import { InitialsAvatar } from "@/shared/avatar";

type Opens =
	| { href: Href; onPress?: never }
	| { onPress: () => void; href?: never };

/** A round icon button of 44 pt in the header on Android: "+" for a new run. */
export function HeaderButton({
	icon,
	label,
	hint,
	...opens
}: {
	icon: LucideIcon;
	/** What a screen reader says: "New run". */
	label: string;
	hint?: string;
} & Opens) {
	const button = (
		<Button
			variant="secondary"
			size="icon"
			className="size-11 rounded-full"
			onPress={opens.onPress}
			accessibilityLabel={label}
			accessibilityHint={hint}
		>
			<Icon as={icon} className="size-5 text-secondary-foreground" />
		</Button>
	);
	return opens.href !== undefined ? (
		<Link href={opens.href} asChild>
			{button}
		</Link>
	) : (
		button
	);
}

/** The person's initials as a round button in the header: opens Settings on Home. */
export function AvatarButton({
	name,
	label,
	hint,
	...opens
}: {
	name: string;
	label: string;
	hint?: string;
} & Opens) {
	const button = (
		<Pressable
			onPress={opens.onPress}
			accessibilityRole="button"
			accessibilityLabel={label}
			accessibilityHint={hint}
			className="rounded-full active:opacity-70"
		>
			<InitialsAvatar name={name} size="md" />
		</Pressable>
	);
	return opens.href !== undefined ? (
		<Link href={opens.href} asChild>
			{button}
		</Link>
	) : (
		button
	);
}
