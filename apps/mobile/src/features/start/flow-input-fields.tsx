import { type InputTexts, jsonProblem } from "@nightshift/client";
import type { FlowInputDef } from "@nightshift/flows";
import { Input } from "@nightshift/ui-native/components/ui/input";
import { Label } from "@nightshift/ui-native/components/ui/label";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { Textarea } from "@nightshift/ui-native/components/ui/textarea";
import { View } from "react-native";

/** One field per input of the flow: text, or JSON for a `json` input. */
export function FlowInputFields({
	inputs,
	values,
	onChange,
}: {
	inputs: readonly FlowInputDef[];
	values: InputTexts;
	onChange: (values: InputTexts) => void;
}) {
	return (
		<View className="gap-5">
			{inputs.map((input) => {
				const label = input.label || input.name;
				const value = values[input.name] ?? "";
				const problem = jsonProblem(input, value);
				const set = (next: string) =>
					onChange({ ...values, [input.name]: next });
				return (
					<View key={input.name} className="gap-2">
						<Label>{input.required ? `${label} (required)` : label}</Label>
						{input.type === "json" ? (
							<Textarea
								value={value}
								onChangeText={set}
								placeholder={input.default ?? '{"title": "Fix the login"}'}
								autoCapitalize="none"
								autoCorrect={false}
								className="font-mono text-sm"
								accessibilityLabel={label}
							/>
						) : (
							<Input
								value={value}
								onChangeText={set}
								placeholder={input.default}
								autoCapitalize="none"
								accessibilityLabel={label}
							/>
						)}
						{problem ? (
							<Text className="text-destructive text-sm">
								Not valid JSON. Check the format, for example{" "}
								{'{"title": "Fix the login"}'}.
							</Text>
						) : input.type === "json" ? (
							<Text variant="muted" className="text-muted-foreground">
								{input.description ? `${input.description} ` : ""}A JSON value,
								for example {'{"title": "Fix the login"}'}.
							</Text>
						) : input.description ? (
							<Text variant="muted" className="text-muted-foreground">
								{input.description}
							</Text>
						) : null}
					</View>
				);
			})}
		</View>
	);
}
