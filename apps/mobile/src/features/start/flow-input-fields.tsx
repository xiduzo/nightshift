import { type InputTexts, inputProblem, isOptional } from "@nightshift/client";
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
import { Switch } from "@nightshift/ui-native/components/ui/switch";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { Textarea } from "@nightshift/ui-native/components/ui/textarea";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** The JSON example under a `json` input. */
const JSON_EXAMPLE = '{"title": "Fix the login"}';

/**
 * One field per input of the flow, by its type: text, a number, a switch,
 * a list to pick from, or JSON.
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

				if (input.type === "boolean") {
					return (
						<View key={input.name} className="gap-2">
							<View className="flex-row items-center justify-between gap-4">
								<Label>{label}</Label>
								<Switch
									checked={(value || input.default) === "true"}
									onCheckedChange={(on) => set(on ? "true" : "false")}
									accessibilityLabel={label}
								/>
							</View>
							{hint}
						</View>
					);
				}

				// An optional choice without a default can stay empty.
				const none = isOptional(input) && !input.default;
				return (
					<View key={input.name} className="gap-2">
						<Label>{isOptional(input) ? `${label} (optional)` : label}</Label>
						{input.type === "choice" ? (
							<Select
								value={value ? { value, label: value } : undefined}
								onValueChange={(option) => set(option?.value ?? "")}
							>
								<SelectTrigger accessibilityLabel={label}>
									<SelectValue placeholder={input.default ?? "None"} />
								</SelectTrigger>
								<SelectContent
									insets={{ top: insets.top, bottom: insets.bottom }}
								>
									<ScrollView className="max-h-64">
										{none ? <SelectItem value="" label="None" /> : null}
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
								placeholder={input.default ?? JSON_EXAMPLE}
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
