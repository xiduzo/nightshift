import type { PlacementChoice } from "@nightshift/client";
import {
	RadioGroup,
	RadioGroupItem,
} from "@nightshift/ui-native/components/ui/radio-group";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { cn } from "@nightshift/ui-native/lib/utils";
import { Pressable, View } from "react-native";

import { ListGroup } from "@/shared/list";
import { placementHint } from "./start-words";

/**
 * Where the run goes: your Host, or a computer that is online, as radio
 * rows in one card. Offline ones show why they cannot take it.
 */
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
		<RadioGroup value={value ?? ""} onValueChange={onChange}>
			<ListGroup>
				{choices.map((choice) => {
					const checked = choice.deviceId === value;
					const hint = placementHint(choice);
					return (
						<Pressable
							key={choice.deviceId}
							onPress={() => onChange(choice.deviceId)}
							disabled={!choice.online}
							accessibilityRole="radio"
							accessibilityLabel={`${choice.name}, ${hint}`}
							accessibilityState={{ checked, disabled: !choice.online }}
							className={cn(
								"min-h-14 flex-row items-center gap-3 px-4 py-3 active:bg-accent",
								!choice.online && "opacity-50",
							)}
						>
							<View
								accessibilityElementsHidden
								importantForAccessibility="no-hide-descendants"
							>
								<RadioGroupItem
									value={choice.deviceId}
									disabled={!choice.online}
								/>
							</View>
							<View className="flex-1 gap-0.5">
								<Text className="font-medium text-base">{choice.name}</Text>
								<Text className="text-muted-foreground text-sm">{hint}</Text>
							</View>
						</Pressable>
					);
				})}
			</ListGroup>
		</RadioGroup>
	);
}
