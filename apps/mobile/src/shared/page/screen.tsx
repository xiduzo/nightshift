import type { ReactNode } from "react";
import { ScrollView } from "react-native";

/**
 * The body of a screen: scrolls, on the theme's background. It starts
 * below the header and above the tab bar, which iOS draws translucent over it.
 */
export function Screen({ children }: { children: ReactNode }) {
	return (
		<ScrollView
			className="flex-1 bg-background"
			contentContainerClassName="flex-grow gap-4 p-4"
			contentInsetAdjustmentBehavior="automatic"
			keyboardShouldPersistTaps="handled"
		>
			{children}
		</ScrollView>
	);
}
