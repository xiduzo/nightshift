import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { Button } from "@nightshift/ui/components/button";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldLabel,
} from "@nightshift/ui/components/field";
import { Input } from "@nightshift/ui/components/input";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
	InputGroupText,
} from "@nightshift/ui/components/input-group";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@nightshift/ui/components/select";
import { Spinner } from "@nightshift/ui/components/spinner";
import { CircleAlertIcon, RotateCcwIcon } from "lucide-react";
import { type ReactNode, useId } from "react";
import type { SettingKey, SettingsForm } from "../hooks/use-settings-form";

/** The daemon's answer when it refused a save. */
export function SaveError({ error }: { error: Error | null }) {
	if (!error) return null;
	return (
		<Alert variant="destructive">
			<CircleAlertIcon />
			<AlertTitle>Not saved</AlertTitle>
			<AlertDescription>{error.message}</AlertDescription>
		</Alert>
	);
}

/** "Reset to defaults" for a whole section, beside its title. */
export function ResetSection({ form }: { form: SettingsForm }) {
	if (!form.canReset) return null;
	return (
		<Button
			type="button"
			variant="ghost"
			size="sm"
			disabled={form.resetting}
			onClick={form.reset}
		>
			{form.resetting ? (
				<Spinner data-icon="inline-start" />
			) : (
				<RotateCcwIcon data-icon="inline-start" />
			)}
			Reset to defaults
		</Button>
	);
}

/** A number or text setting: label, input, error, description. */
export function TextSetting({
	form,
	settingKey,
	label,
	description,
	unit,
	inputMode,
	mono,
	suggestions,
	placeholder,
}: {
	form: SettingsForm;
	settingKey: SettingKey;
	label: string;
	description: ReactNode;
	unit?: string;
	inputMode?: "numeric" | "decimal";
	mono?: boolean;
	suggestions?: readonly string[];
	/** Shown in an empty field: what no value means. */
	placeholder?: string;
}) {
	const id = useId();
	const error = form.error(settingKey);
	const describedBy = `${id}-description${error ? ` ${id}-error` : ""}`;
	const inputProps = {
		id,
		value: form.value(settingKey),
		onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
			form.set(settingKey, event.target.value),
		onBlur: form.flush,
		inputMode,
		autoComplete: "off",
		spellCheck: false,
		list: suggestions ? `${id}-suggestions` : undefined,
		placeholder,
		"aria-invalid": error ? true : undefined,
		"aria-describedby": describedBy,
		className: mono ? "font-mono" : "tabular-nums",
	} as const;

	return (
		<Field data-invalid={error ? true : undefined}>
			<FieldLabel htmlFor={id}>{label}</FieldLabel>
			{unit ? (
				<InputGroup>
					<InputGroupInput {...inputProps} />
					<InputGroupAddon align="inline-end">
						<InputGroupText>{unit}</InputGroupText>
					</InputGroupAddon>
				</InputGroup>
			) : (
				<Input {...inputProps} />
			)}
			{suggestions ? (
				<datalist id={`${id}-suggestions`}>
					{suggestions.map((value) => (
						<option key={value} value={value} />
					))}
				</datalist>
			) : null}
			{error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
			<FieldDescription id={`${id}-description`}>
				{description}
			</FieldDescription>
		</Field>
	);
}

/** A choice from a short list, in a Select. */
export function SelectSetting<V extends string>({
	form,
	settingKey,
	label,
	description,
	options,
	onPick,
}: {
	form: SettingsForm;
	settingKey: SettingKey;
	label: string;
	description: ReactNode;
	options: readonly { value: V; label: string }[];
	onPick?: (value: V) => void;
}) {
	const id = useId();
	return (
		<Field>
			<FieldLabel htmlFor={id}>{label}</FieldLabel>
			<Select
				items={options}
				value={form.value(settingKey) as V}
				onValueChange={(value) => {
					if (value === null) return;
					form.set(settingKey, value);
					onPick?.(value);
				}}
			>
				<SelectTrigger
					id={id}
					className="w-full"
					aria-describedby={`${id}-description`}
				>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectGroup>
						{options.map((option) => (
							<SelectItem key={option.value} value={option.value}>
								{option.label}
							</SelectItem>
						))}
					</SelectGroup>
				</SelectContent>
			</Select>
			<FieldDescription id={`${id}-description`}>
				{description}
			</FieldDescription>
		</Field>
	);
}

/** A form inside a card: Enter saves at once. */
export function CardForm({
	form,
	children,
}: {
	form: SettingsForm;
	children: ReactNode;
}) {
	return (
		<form
			className="contents"
			noValidate
			onSubmit={(event) => {
				event.preventDefault();
				form.flush();
			}}
		>
			{children}
		</form>
	);
}
