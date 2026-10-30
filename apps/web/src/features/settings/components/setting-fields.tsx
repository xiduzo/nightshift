import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import { CardFooter } from "@nightshift/ui/components/card";
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
import { CircleAlertIcon, SaveIcon } from "lucide-react";
import { type ReactNode, useId } from "react";
import type { SettingsView } from "@/shared/api";
import type {
	SettingField,
	SettingKey,
	SettingsForm,
} from "../hooks/use-settings-form";

/** Discard and Save at the bottom of a card with a form. */
export function FormFooter({
	form,
	label,
}: {
	form: SettingsForm;
	label: string;
}) {
	return (
		<CardFooter className="justify-end gap-2 border-t">
			{form.dirty && !form.saving ? (
				<Button type="button" variant="ghost" onClick={form.discard}>
					Discard
				</Button>
			) : null}
			<Button
				type="submit"
				disabled={!form.dirty || form.invalid || form.saving}
			>
				{form.saving ? (
					<Spinner data-icon="inline-start" />
				) : (
					<SaveIcon data-icon="inline-start" />
				)}
				{form.saving ? "Saving…" : label}
			</Button>
		</CardFooter>
	);
}

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

/** Where a value comes from: its default, the daemon's environment, or a saved value. */
export function SettingSource({
	field,
	label,
	format = String,
	resetting,
	onReset,
}: {
	field: SettingField;
	label: string;
	format?: (value: unknown) => string;
	resetting: boolean;
	onReset: () => void;
}) {
	const fallback =
		field.envValue !== undefined
			? `${format(field.envValue)}, set outside Night Shift`
			: `${format(field.default)}, the default`;
	return (
		<div className="flex min-h-6 flex-wrap items-center gap-2">
			{field.source === "saved" ? (
				<>
					<Badge variant="secondary">Saved</Badge>
					<Button
						type="button"
						variant="ghost"
						size="xs"
						disabled={resetting}
						title={`Back to ${fallback}`}
						aria-label={`Reset ${label}, back to ${fallback}`}
						onClick={onReset}
					>
						{resetting ? <Spinner data-icon="inline-start" /> : null}
						Reset
					</Button>
				</>
			) : field.source === "env" ? (
				<Badge variant="outline" className="font-mono">
					Set outside Night Shift
				</Badge>
			) : (
				<Badge variant="outline" className="text-muted-foreground">
					Default
				</Badge>
			)}
		</div>
	);
}

/** A number or text setting: label, input, description, error, source. */
export function TextSetting({
	form,
	data,
	settingKey,
	label,
	description,
	unit,
	inputMode,
	mono,
	suggestions,
	placeholder,
	format,
}: {
	form: SettingsForm;
	data: SettingsView;
	settingKey: SettingKey;
	label: string;
	description: ReactNode;
	unit?: string;
	inputMode?: "numeric" | "decimal";
	mono?: boolean;
	suggestions?: readonly string[];
	/** Shown in an empty field: what no value means. */
	placeholder?: string;
	/** How the source line writes a value, such as the default. */
	format?: (value: unknown) => string;
}) {
	const id = useId();
	const error = form.error(settingKey);
	const describedBy = `${id}-description${error ? ` ${id}-error` : ""}`;
	const inputProps = {
		id,
		value: form.value(settingKey),
		onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
			form.set(settingKey, event.target.value),
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
			<SettingSource
				field={data.fields[settingKey]}
				label={label}
				{...(format ? { format } : {})}
				resetting={form.resettingKey === settingKey}
				onReset={() => form.reset(settingKey, label)}
			/>
		</Field>
	);
}

/** A choice from a short list, in a Select. */
export function SelectSetting<V extends string>({
	form,
	data,
	settingKey,
	label,
	description,
	options,
	onPick,
}: {
	form: SettingsForm;
	data: SettingsView;
	settingKey: SettingKey;
	label: string;
	description: ReactNode;
	options: readonly { value: V; label: string }[];
	onPick?: (value: V) => void;
}) {
	const id = useId();
	const labelOf = (value: unknown) =>
		options.find((option) => option.value === value)?.label ?? String(value);
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
			<SettingSource
				field={data.fields[settingKey]}
				label={label}
				format={labelOf}
				resetting={form.resettingKey === settingKey}
				onReset={() => form.reset(settingKey, label)}
			/>
		</Field>
	);
}

/** A form inside a card: Enter saves. */
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
				if (form.dirty && !form.invalid && !form.saving) form.save();
			}}
		>
			{children}
		</form>
	);
}
