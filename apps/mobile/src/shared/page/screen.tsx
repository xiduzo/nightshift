import type { ReactNode } from "react";
import { ScrollView } from "react-native";

/** The body of a screen: scrolls, on the theme's background. */
export function Screen({ children }: { children: ReactNode }) {
	return (
		<ScrollView
			className="flex-1 bg-background"
			contentContainerClassName="flex-grow gap-4 p-4"
			keyboardShouldPersistTaps="handled"
		>
			{children}
		</ScrollView>
	);
}
