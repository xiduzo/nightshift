import { Label } from "@nightshift/ui-native/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@nightshift/ui-native/components/ui/select";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export type Choice = { value: string; label: string; disabled?: boolean };

/** A label and a Select of one of a few choices. A screen reader hears the label and the choice. */
export function ChoiceSelect({
	label,
	placeholder,
	choices,
	value,
	onChange,
}: {
	label: string;
	placeholder: string;
	choices: Choice[];
	value: string | null;
	onChange: (value: string) => void;
}) {
	const insets = useSafeAreaInsets();
	const chosen = choices.find((choice) => choice.value === value);
	return (
		<View className="gap-2">
			<Label>{label}</Label>
			<Select
				value={
					chosen ? { value: chosen.value, label: chosen.label } : undefined
				}
				onValueChange={(option) => option && onChange(option.value)}
			>
				<SelectTrigger
					accessibilityLabel={label}
					accessibilityValue={{ text: chosen?.label ?? placeholder }}
				>
					<SelectValue placeholder={placeholder} />
				</SelectTrigger>
				<SelectContent
					insets={{
						top: insets.top,
						bottom: insets.bottom,
						left: 16,
						right: 16,
					}}
					className="w-[90%]"
				>
					<ScrollView className="max-h-80">
						{choices.map((choice) => (
							<SelectItem
								key={choice.value}
								value={choice.value}
								label={choice.label}
								disabled={choice.disabled}
							/>
						))}
					</ScrollView>
				</SelectContent>
			</Select>
		</View>
	);
}
