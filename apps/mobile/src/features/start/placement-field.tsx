import type { PlacementChoice } from "@nightshift/client";
import { Label } from "@nightshift/ui-native/components/ui/label";
import {
	RadioGroup,
	RadioGroupItem,
} from "@nightshift/ui-native/components/ui/radio-group";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { View } from "react-native";

/** What one place is, for the person who picks it. */
function hintOf(choice: PlacementChoice): string {
	if (!choice.online) {
		return "Offline. Open Night Shift on that computer to run flows on it.";
	}
	if (choice.offers !== undefined) {
		return choice.offers.length === 0
			? "Another person offers this computer to the Space, with no profiles."
			: `Another person offers this computer to the Space, with ${choice.offers.join(", ")}.`;
	}
	return choice.thisDevice ? "Your Host." : "One of your computers.";
}

/** Where the run goes: the Host, or a computer that is online. Offline ones show why they cannot take it. */
export function PlacementField({
	choices,
	value,
	onChange,
}: {
	choices: PlacementChoice[];
	value: string | null;
	onChange: (deviceId: string) => void;
}) {
	return (
		<RadioGroup value={value ?? ""} onValueChange={onChange} className="gap-4">
			{choices.map((choice) => {
				const id = `place-${choice.deviceId}`;
				return (
					<View key={choice.deviceId} className="flex-row items-start gap-3">
						<RadioGroupItem
							value={choice.deviceId}
							aria-labelledby={id}
							disabled={!choice.online}
							className="mt-0.5"
						/>
						<View className="flex-1 gap-1">
							<Label
								nativeID={id}
								disabled={!choice.online}
								onPress={() => choice.online && onChange(choice.deviceId)}
							>
								{choice.name}
							</Label>
							<Text variant="muted" className="text-muted-foreground">
								{hintOf(choice)}
							</Text>
						</View>
					</View>
				);
			})}
		</RadioGroup>
	);
}
