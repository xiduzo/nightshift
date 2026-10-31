import {
	type AskOption,
	type AskValue,
	type AskValues,
	askFormFields,
	askOptions,
} from "@nightshift/client";
import type { AskField, AskForm } from "@nightshift/flows";
import { Card } from "@nightshift/ui-native/components/ui/card";
import { Checkbox } from "@nightshift/ui-native/components/ui/checkbox";
import { Input } from "@nightshift/ui-native/components/ui/input";
import { Label } from "@nightshift/ui-native/components/ui/label";
import {
	RadioGroup,
	RadioGroupItem,
} from "@nightshift/ui-native/components/ui/radio-group";
import { Switch } from "@nightshift/ui-native/components/ui/switch";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { Textarea } from "@nightshift/ui-native/components/ui/textarea";
import { cn } from "@nightshift/ui-native/lib/utils";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";

import { AskFiles } from "./ask-files";

/**
 * The fields of an Ask's form on the phone (ADR 10): a text field, a
 * choice as cards, a choice of several as cards with a checkbox, a switch
 * and a number field. The phone draws only these (`phoneCanAnswer`); any
 * other form opens the web page.
 */
export function AskFields({
	form,
	values,
	onChange,
	disabled,
	files,
}: {
	form: AskForm;
	values: AskValues;
	onChange: (name: string, value: AskValue) => void;
	disabled: boolean;
	/** Where a choice's images load from, or null when the phone shows only their names. */
	files: { runId: string; address: string; walkedHere: boolean };
}) {
	return (
		<View className="gap-5">
			{askFormFields(form).map((field) => (
				<AskFieldInput
					key={field.name}
					form={form}
					field={field}
					value={values[field.name]}
					disabled={disabled}
					files={files}
					onChange={(value) => onChange(field.name, value)}
				/>
			))}
		</View>
	);
}

function FieldHead({ field, id }: { field: AskField; id: string }) {
	return (
		<View className="gap-1">
			<Label nativeID={id}>
				{field.required ? field.label : `${field.label} (optional)`}
			</Label>
			{field.hint ? (
				<Text className="text-muted-foreground text-xs">{field.hint}</Text>
			) : null}
		</View>
	);
}

function AskFieldInput({
	form,
	field,
	value,
	disabled,
	files,
	onChange,
}: {
	form: AskForm;
	field: AskField;
	value: AskValue | undefined;
	disabled: boolean;
	files: { runId: string; address: string; walkedHere: boolean };
	onChange: (value: AskValue) => void;
}) {
	const id = `ask-${field.name}`;
	switch (field.kind) {
		case "switch":
			return (
				<View className="flex-row items-center gap-3">
					<View className="flex-1">
						<FieldHead field={{ ...field, required: true }} id={id} />
					</View>
					<Switch
						aria-labelledby={id}
						checked={value === true}
						onCheckedChange={(checked) => onChange(checked)}
						disabled={disabled}
					/>
				</View>
			);
		case "choice": {
			const chosen = typeof value === "string" ? value : "";
			return (
				<View className="gap-2">
					<FieldHead field={field} id={id} />
					<RadioGroup
						value={chosen === "" ? undefined : chosen}
						onValueChange={(next) => onChange(next)}
						disabled={disabled}
						aria-labelledby={id}
					>
						{askOptions(form, field).map((option) => (
							<OptionCard
								key={option.name}
								option={option}
								selected={chosen === option.name}
								role="radio"
								disabled={disabled}
								files={files}
								onPress={() => onChange(option.name)}
							>
								<RadioGroupItem value={option.name} className="size-5" />
							</OptionCard>
						))}
					</RadioGroup>
				</View>
			);
		}
		case "choices": {
			const picked = Array.isArray(value) ? value : [];
			const toggle = (name: string) =>
				onChange(
					picked.includes(name)
						? picked.filter((one) => one !== name)
						: [...picked, name],
				);
			return (
				<View className="gap-2">
					<FieldHead field={field} id={id} />
					<View className="gap-3">
						{askOptions(form, field).map((option) => (
							<OptionCard
								key={option.name}
								option={option}
								selected={picked.includes(option.name)}
								role="checkbox"
								disabled={disabled}
								files={files}
								onPress={() => toggle(option.name)}
							>
								<Checkbox
									checked={picked.includes(option.name)}
									onCheckedChange={() => toggle(option.name)}
									className="size-5"
								/>
							</OptionCard>
						))}
					</View>
				</View>
			);
		}
		case "number":
			return (
				<View className="gap-2">
					<FieldHead field={field} id={id} />
					<Input
						aria-labelledby={id}
						value={typeof value === "string" ? value : ""}
						onChangeText={onChange}
						keyboardType={field.integer ? "number-pad" : "decimal-pad"}
						editable={!disabled}
					/>
				</View>
			);
		default:
			return (
				<View className="gap-2">
					<FieldHead field={field} id={id} />
					<Textarea
						aria-labelledby={id}
						value={typeof value === "string" ? value : ""}
						onChangeText={onChange}
						editable={!disabled}
						numberOfLines={3}
					/>
				</View>
			);
	}
}

/** One option as a card: its label, description and images, with its radio or checkbox. */
function OptionCard({
	option,
	selected,
	role,
	disabled,
	files,
	onPress,
	children,
}: {
	option: AskOption;
	selected: boolean;
	role: "radio" | "checkbox";
	disabled: boolean;
	files: { runId: string; address: string; walkedHere: boolean };
	onPress: () => void;
	children: ReactNode;
}) {
	return (
		<Pressable
			onPress={onPress}
			disabled={disabled}
			accessibilityRole={role}
			accessibilityState={{ checked: selected, disabled }}
			accessibilityLabel={[option.label, option.description]
				.filter(Boolean)
				.join(", ")}
		>
			<Card
				className={cn(
					"flex-row gap-3 px-4 py-4",
					selected && "border-primary bg-accent",
					disabled && !selected && "opacity-50",
				)}
			>
				<View className="flex-1 gap-1.5">
					<Text className="font-semibold text-base">{option.label}</Text>
					{option.description ? (
						<Text className="text-muted-foreground text-sm">
							{option.description}
						</Text>
					) : null}
					{option.attachments && option.attachments.length > 0 ? (
						<AskFiles attachments={option.attachments} {...files} />
					) : null}
				</View>
				<View
					pointerEvents="none"
					accessibilityElementsHidden
					importantForAccessibility="no-hide-descendants"
					className="pt-0.5"
				>
					{children}
				</View>
			</Card>
		</Pressable>
	);
}
