import type { Stack } from "expo-router";
import type { LucideIcon } from "lucide-react-native";
import type { ComponentProps, ReactElement } from "react";

/** An SF Symbol for an iOS header button: "plus", "ellipsis". */
type SfIcon = NonNullable<ComponentProps<typeof Stack.Toolbar.Button>["icon"]>;

/**
 * One item on a side of a screen's native header. A button is a system
 * button on iOS (an SF Symbol) and a round icon button on Android (a
 * lucide icon). A menu picks one of its options: a system menu on iOS, a
 * Material menu on Android (the Space). A view is any element: the avatar.
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
	| {
			kind: "menu";
			key: string;
			/** What a screen reader says: "Space, Personal". */
			label: string;
			hint?: string;
			/** iOS: the symbol of the button. Android shows `title` instead. */
			sf: SfIcon;
			/** The chosen option: on top of the menu on iOS, on the button on Android. */
			title: string;
			options: readonly { value: string; label: string }[];
			/** The option with a check. */
			value: string | null;
			onChange: (value: string) => void;
			disabled?: boolean;
	  }
	| { kind: "view"; key: string; element: ReactElement };

export type HeaderToolbarProps = {
	placement: "left" | "right";
	items: readonly HeaderItem[];
};
