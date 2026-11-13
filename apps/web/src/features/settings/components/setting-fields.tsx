import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { Button } from "@nightshift/ui/components/button";
import { Card, CardContent } from "@nightshift/ui/components/card";
import {
	FieldDescription,
	FieldGroup,
	FieldLegend,
	FieldSet,
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
import { Switch } from "@nightshift/ui/components/switch";
import { CircleAlertIcon, RotateCcwIcon } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { toast } from "sonner";
import { KeyValueRows, recordFrom, rowsFrom } from "@/features/agents";
import { SettingNote, SettingRow } from "@/shared/page";
import {
	type SettingKey,
	type SettingsForm,
	useSaveSettings,
} from "../hooks/use-settings-form";

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

/** The same answer as a row of a settings table. */
export function SaveErrorRow({ error }: { error: Error | null }) {
	if (!error) return null;
	return (
		<SettingNote>
			<SaveError error={error} />
		</SettingNote>
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

/** A number or text setting, as a row: label, description and error, then the input. */
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
	description?: ReactNode;
	unit?: string;
	inputMode?: "numeric" | "decimal";
	mono?: boolean;
	suggestions?: readonly string[];
	/** Shown in an empty field: what no value means. */
	placeholder?: string;
}) {
	const id = useId();
	const error = form.error(settingKey);
	const describedBy =
		[description ? `${id}-description` : null, error ? `${id}-error` : null]
			.filter(Boolean)
			.join(" ") || undefined;
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
		<SettingRow
			label={label}
			htmlFor={id}
			description={
				description ? <span id={`${id}-description`}>{description}</span> : null
			}
			error={error ? <span id={`${id}-error`}>{error}</span> : null}
		>
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
		</SettingRow>
	);
}

/** A choice from a short list, in a Select, as a row. */
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
	description?: ReactNode;
	options: readonly { value: V; label: string }[];
	onPick?: (value: V) => void;
}) {
	const id = useId();
	return (
		<SettingRow
			label={label}
			htmlFor={id}
			description={
				description ? <span id={`${id}-description`}>{description}</span> : null
			}
		>
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
					aria-describedby={description ? `${id}-description` : undefined}
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
		</SettingRow>
	);
}

/** A setting that is on or off, as a row. It saves at once. */
export function SwitchSetting({
	label,
	description,
	checked,
	disabled,
	describedBy,
	onCheckedChange,
}: {
	label: string;
	description?: ReactNode;
	checked: boolean;
	disabled?: boolean;
	describedBy?: string;
	onCheckedChange: (checked: boolean) => void;
}) {
	const id = useId();
	return (
		<SettingRow label={label} htmlFor={id} description={description}>
			<Switch
				id={id}
				checked={checked}
				disabled={disabled}
				aria-describedby={describedBy}
				onCheckedChange={onCheckedChange}
			/>
		</SettingRow>
	);
}

/** A form around a table of settings: Enter saves at once. */
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

/**
 * Headers a setting sends with each request, name → value. A value is a
 * `${NAME}` reference to a secret, as in a connection: the value itself
 * stays on the Secrets page. Give it a `key` of the saved value, so a new
 * saved value starts a new draft.
 */
export function HeadersCard({
	settingKey,
	saved,
	description,
	valuePlaceholder,
}: {
	settingKey: "telemetryHeaders" | "ollamaHeaders";
	saved: Record<string, string>;
	description: ReactNode;
	valuePlaceholder: string;
}) {
	const [rows, setRows] = useState(() => rowsFrom(saved));
	const save = useSaveSettings();
	const draft = recordFrom(rows);
	const changed = JSON.stringify(draft) !== JSON.stringify(saved);

	return (
		<Card>
			<form
				className="contents"
				noValidate
				onSubmit={(event) => {
					event.preventDefault();
					if (!changed || save.isPending) return;
					save.mutate(
						{ [settingKey]: draft },
						{ onSuccess: () => toast.success("Headers saved") },
					);
				}}
			>
				<CardContent>
					<FieldGroup>
						<FieldSet className="gap-3">
							<FieldLegend variant="label">Headers</FieldLegend>
							<FieldDescription>{description}</FieldDescription>
							<KeyValueRows
								rows={rows}
								onChange={(next) => {
									save.reset();
									setRows(next);
								}}
								keyLabel="Header"
								keyPlaceholder="Authorization"
								valuePlaceholder={valuePlaceholder}
								addLabel="Add header"
							/>
						</FieldSet>
						<SaveError error={save.error} />
						<div className="flex justify-end">
							<Button type="submit" disabled={!changed || save.isPending}>
								{save.isPending ? <Spinner data-icon="inline-start" /> : null}
								Save headers
							</Button>
						</div>
					</FieldGroup>
				</CardContent>
			</form>
		</Card>
	);
}
