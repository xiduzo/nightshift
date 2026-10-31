import { Text } from "@nightshift/ui-native/components/ui/text";
import { View } from "react-native";

import { ListGroup, ListRow, SectionHead } from "@/shared/list";
import { APPEARANCES, useAppearance } from "@/shared/theme";

/** Dark, light, or as the phone is set. The choice stays on this phone. */
export function AppearanceSection() {
	const [appearance, setAppearance] = useAppearance();
	return (
		<View className="gap-3">
			<SectionHead title="Appearance" />
			<ListGroup>
				{APPEARANCES.map((choice) => (
					<ListRow
						key={choice.value}
						title={choice.label}
						selected={choice.value === appearance}
						onPress={() => setAppearance(choice.value)}
					/>
				))}
			</ListGroup>
			<Text variant="muted" className="text-muted-foreground">
				Dark suits the night. System follows this phone.
			</Text>
		</View>
	);
}
