import type { Stack } from "expo-router";
import type { LucideIcon } from "lucide-react-native";
import type { ComponentProps, ReactElement } from "react";

/** An SF Symbol for an iOS header button: "plus", "ellipsis". */
type SfIcon = NonNullable<ComponentProps<typeof Stack.Toolbar.Button>["icon"]>;

/**
 * One item on a side of a screen's native header. A button is a system
 * button on iOS (an SF Symbol) and a round icon button on Android (a
 * lucide icon). A view is any element: the Space picker, the avatar.
 */
export type HeaderItem =
	| {
			kind: "button";
			key: string;
			/** What a screen reader says: "New run". */
			label: string;
			hint?: string;
			sf: SfIcon;
			icon: LucideIcon;
			/** iOS: the word on the button instead of the icon: "Skip". */
			text?: string;
			onPress: () => void;
	  }
	| { kind: "view"; key: string; element: ReactElement };

export type HeaderToolbarProps = {
	placement: "left" | "right";
	items: readonly HeaderItem[];
};
