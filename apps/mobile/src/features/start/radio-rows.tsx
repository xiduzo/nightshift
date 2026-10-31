import {
	RadioGroup,
	RadioGroupItem,
} from "@nightshift/ui-native/components/ui/radio-group";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { cn } from "@nightshift/ui-native/lib/utils";
import { Pressable, View } from "react-native";

import { ListGroup } from "@/shared/list";

export type RadioChoice = {
	value: string;
	title: string;
	/** One muted line under the title. */
	caption?: string;
	disabled?: boolean;
};

/**
 * One of a few choices, as radio rows in one card: a radio, a title and
 * a muted line. The whole row is one radio of at least 44 pt.
 */
export function RadioRows({
	label,
	choices,
	value,
	onChange,
}: {
	/** What the group chooses, for a screen reader: "Flow". */
	label: string;
	choices: readonly RadioChoice[];
	value: string | null;
	onChange: (value: string) => void;
}) {
	return (
		<RadioGroup
			value={value ?? ""}
			onValueChange={onChange}
			accessibilityLabel={label}
		>
			<ListGroup>
				{choices.map((choice) => {
					const checked = choice.value === value;
					return (
						<Pressable
							key={choice.value}
							onPress={() => onChange(choice.value)}
							disabled={choice.disabled}
							accessibilityRole="radio"
							accessibilityLabel={[choice.title, choice.caption]
								.filter(Boolean)
								.join(", ")}
							accessibilityState={{ checked, disabled: choice.disabled }}
							className={cn(
								"min-h-14 flex-row items-center gap-3 px-4 py-3 active:bg-accent",
								choice.disabled && "opacity-50",
							)}
						>
							<View
								accessibilityElementsHidden
								importantForAccessibility="no-hide-descendants"
							>
								<RadioGroupItem
									value={choice.value}
									disabled={choice.disabled}
								/>
							</View>
							<View className="flex-1 gap-0.5">
								<Text className="font-medium text-base">{choice.title}</Text>
								{choice.caption ? (
									<Text className="text-muted-foreground text-sm">
										{choice.caption}
									</Text>
								) : null}
							</View>
						</Pressable>
					);
				})}
			</ListGroup>
		</RadioGroup>
	);
}
