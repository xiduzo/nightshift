import { type InputTexts, inputProblem } from "@nightshift/client";
import type { FlowInputDef } from "@nightshift/flows";
import { Input } from "@nightshift/ui-native/components/ui/input";
import { Label } from "@nightshift/ui-native/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@nightshift/ui-native/components/ui/select";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { Textarea } from "@nightshift/ui-native/components/ui/textarea";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** The JSON example under a `json` input. */
const JSON_EXAMPLE = '{"title": "Fix the login"}';

/**
 * One field per input the run cannot start without, by its type: text, a
 * number, a list to pick from, or JSON. A switch has a value already, so
 * it is never one of them.
 */
export function FlowInputFields({
	inputs,
	values,
	onChange,
}: {
	inputs: readonly FlowInputDef[];
	values: InputTexts;
	onChange: (values: InputTexts) => void;
}) {
	const insets = useSafeAreaInsets();
	return (
		<View className="gap-5">
			{inputs.map((input) => {
				const label = input.label || input.name;
				const value = values[input.name] ?? "";
				const problem = inputProblem(input, value);
				const set = (next: string) =>
					onChange({ ...values, [input.name]: next });
				const hint = problem ? (
					<Text className="text-destructive text-sm">
						{input.type === "json"
							? `Not valid JSON. Check the format, for example ${JSON_EXAMPLE}.`
							: problem}
					</Text>
				) : input.type === "json" ? (
					<Text variant="muted" className="text-muted-foreground">
						{input.description ? `${input.description} ` : ""}A JSON value, for
						example {JSON_EXAMPLE}.
					</Text>
				) : input.description ? (
					<Text variant="muted" className="text-muted-foreground">
						{input.description}
					</Text>
				) : null;

				return (
					<View key={input.name} className="gap-2">
						<Label>{label}</Label>
						{input.type === "choice" ? (
							<Select
								value={value ? { value, label: value } : undefined}
								onValueChange={(option) => set(option?.value ?? "")}
							>
								<SelectTrigger accessibilityLabel={label}>
									<SelectValue placeholder="Choose one" />
								</SelectTrigger>
								<SelectContent
									insets={{ top: insets.top, bottom: insets.bottom }}
								>
									<ScrollView className="max-h-64">
										{(input.options ?? []).map((option) => (
											<SelectItem key={option} value={option} label={option} />
										))}
									</ScrollView>
								</SelectContent>
							</Select>
						) : input.type === "json" ? (
							<Textarea
								value={value}
								onChangeText={set}
								placeholder={JSON_EXAMPLE}
								autoCapitalize="none"
								autoCorrect={false}
								className="font-mono text-sm"
								accessibilityLabel={label}
							/>
						) : (
							<Input
								value={value}
								onChangeText={set}
								autoCapitalize="none"
								keyboardType={
									input.type === "number"
										? "numbers-and-punctuation"
										: "default"
								}
								accessibilityLabel={label}
							/>
						)}
						{hint}
					</View>
				);
			})}
		</View>
	);
}
