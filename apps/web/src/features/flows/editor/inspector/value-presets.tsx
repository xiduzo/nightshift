/**
 * "Start from" on a Value made by a rule: a preset (Filter, Pick fields,
 * Sort, Limit, Remove duplicates) writes the expression and the output
 * schema for a list of an earlier node. `@nightshift/flows` builds them
 * (`valuePreset`); this is the form.
 */
import {
	FILTER_COMPARES,
	type FilterCompare,
	type Flow,
	itemFields,
	type PresetSource,
	presetSources,
	templateScope,
	VALUE_PRESETS,
	type ValueNode,
	type ValuePresetInput,
	type ValuePresetName,
	valuePreset,
} from "@nightshift/flows";
import { Button } from "@nightshift/ui/components/button";
import { Checkbox } from "@nightshift/ui/components/checkbox";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@nightshift/ui/components/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@nightshift/ui/components/dropdown-menu";
import {
	Field,
	FieldDescription,
	FieldGroup,
	FieldLabel,
	FieldLegend,
	FieldSet,
} from "@nightshift/ui/components/field";
import { Input } from "@nightshift/ui/components/input";
import {
	NativeSelect,
	NativeSelectOption,
} from "@nightshift/ui/components/native-select";
import { ChevronDownIcon } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { useProjectFlowMap } from "../project-flows-context";

/** The form's values for every preset: one form, so a switch keeps them. */
type FormValues = {
	source: string;
	field: string;
	compare: FilterCompare;
	value: string;
	fields: string[];
	order: "ascending" | "descending";
	count: number;
};

const START: FormValues = {
	source: "",
	field: "",
	compare: "equals",
	value: "",
	fields: [],
	order: "ascending",
	count: 10,
};

/** The preset input of the form, or null while it misses something. */
function inputOf(
	preset: ValuePresetName,
	values: FormValues,
): ValuePresetInput | null {
	const { source } = values;
	if (source === "") return null;
	switch (preset) {
		case "filter":
			return {
				preset,
				source,
				field: values.field,
				compare: values.compare,
				value: values.value,
			};
		case "pick":
			return values.fields.length === 0
				? null
				: { preset, source, fields: values.fields };
		case "sort":
			return { preset, source, field: values.field, order: values.order };
		case "limit":
			return { preset, source, count: values.count };
		case "unique":
			return { preset, source, field: values.field };
	}
}

export function ValuePresetMenu({
	flow,
	node,
	onUse,
}: {
	flow: Flow;
	node: ValueNode;
	onUse: (made: {
		expression: string;
		output: Record<string, unknown>;
	}) => void;
}) {
	const [preset, setPreset] = useState<ValuePresetName | null>(null);
	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger
					render={<Button variant="outline" size="sm" className="self-start" />}
				>
					Start from
					<ChevronDownIcon data-icon="inline-end" />
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start" className="w-64">
					{VALUE_PRESETS.map((entry) => (
						<DropdownMenuItem
							key={entry.name}
							className="flex-col items-start gap-0"
							onClick={() => setPreset(entry.name)}
						>
							<span>{entry.label}</span>
							<span className="text-muted-foreground text-xs">
								{entry.description}
							</span>
						</DropdownMenuItem>
					))}
				</DropdownMenuContent>
			</DropdownMenu>
			<Dialog
				open={preset !== null}
				onOpenChange={(open) => {
					if (!open) setPreset(null);
				}}
			>
				<DialogContent className="sm:max-w-md">
					{preset !== null ? (
						<PresetForm
							preset={preset}
							flow={flow}
							node={node}
							onUse={(made) => {
								onUse(made);
								setPreset(null);
							}}
						/>
					) : null}
				</DialogContent>
			</Dialog>
		</>
	);
}

function PresetForm({
	preset,
	flow,
	node,
	onUse,
}: {
	preset: ValuePresetName;
	flow: Flow;
	node: ValueNode;
	onUse: (made: {
		expression: string;
		output: Record<string, unknown>;
	}) => void;
}) {
	const id = useId();
	const flows = useProjectFlowMap();
	const sources = useMemo(
		() => presetSources(templateScope(flow, { flows }), node.id),
		[flow, flows, node.id],
	);
	const [values, setValues] = useState<FormValues>(() => ({
		...START,
		source: sources[0]?.ref ?? "",
	}));
	const set = (change: Partial<FormValues>) =>
		setValues((current) => ({ ...current, ...change }));
	const source: PresetSource | undefined = sources.find(
		(candidate) => candidate.ref === values.source,
	);
	const fields = source ? itemFields(source.item) : [];
	const input = inputOf(preset, values);
	const meta = VALUE_PRESETS.find((entry) => entry.name === preset);
	const replaces = (node.expression ?? "").trim() !== "";

	return (
		<form
			className="contents"
			onSubmit={(event) => {
				event.preventDefault();
				if (input !== null) onUse(valuePreset(input, source?.item));
			}}
		>
			<DialogHeader>
				<DialogTitle>{meta?.label}</DialogTitle>
				<DialogDescription>
					{meta?.description}
					{replaces ? " It replaces the expression and the output." : ""}
				</DialogDescription>
			</DialogHeader>
			<FieldGroup>
				<Field>
					<FieldLabel htmlFor={`${id}-source`}>List</FieldLabel>
					<NativeSelect
						id={`${id}-source`}
						className="w-full font-mono"
						value={values.source}
						disabled={sources.length === 0}
						onChange={(event) =>
							set({ source: event.target.value, field: "", fields: [] })
						}
					>
						{sources.map((candidate) => (
							<NativeSelectOption key={candidate.ref} value={candidate.ref}>
								{`{{${candidate.ref}}}`}
							</NativeSelectOption>
						))}
					</NativeSelect>
					{sources.length === 0 ? (
						<FieldDescription>
							No earlier node gives a list yet. Give one an output schema with a
							list, or write the expression yourself.
						</FieldDescription>
					) : null}
				</Field>

				{preset === "filter" ? (
					<>
						<ItemField
							id={`${id}-field`}
							label="Field"
							whole="The item itself"
							fields={fields}
							value={values.field}
							onChange={(field) => set({ field })}
						/>
						<Field>
							<FieldLabel htmlFor={`${id}-compare`}>
								Keep the items where it
							</FieldLabel>
							<NativeSelect
								id={`${id}-compare`}
								className="w-full"
								value={values.compare}
								onChange={(event) =>
									set({ compare: event.target.value as FilterCompare })
								}
							>
								{FILTER_COMPARES.map((entry) => (
									<NativeSelectOption key={entry.compare} value={entry.compare}>
										{entry.label}
									</NativeSelectOption>
								))}
							</NativeSelect>
						</Field>
						{values.compare === "exists" ? null : (
							<Field>
								<FieldLabel htmlFor={`${id}-value`}>Value</FieldLabel>
								<Input
									id={`${id}-value`}
									value={values.value}
									placeholder="open"
									onChange={(event) => set({ value: event.target.value })}
								/>
							</Field>
						)}
					</>
				) : null}

				{preset === "pick" ? (
					fields.length > 0 ? (
						<FieldSet>
							<FieldLegend variant="label">Fields to keep</FieldLegend>
							<FieldGroup className="gap-2">
								{fields.map((name) => (
									<Field key={name} orientation="horizontal">
										<Checkbox
											id={`${id}-pick-${name}`}
											checked={values.fields.includes(name)}
											onCheckedChange={(checked) =>
												set({
													fields: checked
														? [...values.fields, name]
														: values.fields.filter((kept) => kept !== name),
												})
											}
										/>
										<FieldLabel
											htmlFor={`${id}-pick-${name}`}
											className="font-mono font-normal"
										>
											{name}
										</FieldLabel>
									</Field>
								))}
							</FieldGroup>
						</FieldSet>
					) : (
						<Field>
							<FieldLabel htmlFor={`${id}-fields`}>Fields to keep</FieldLabel>
							<Input
								id={`${id}-fields`}
								className="font-mono"
								placeholder="title, link"
								onChange={(event) =>
									set({
										fields: event.target.value
											.split(",")
											.map((name) => name.trim())
											.filter((name) => name !== ""),
									})
								}
							/>
						</Field>
					)
				) : null}

				{preset === "sort" ? (
					<>
						<ItemField
							id={`${id}-field`}
							label="Sort by"
							whole="The item itself"
							fields={fields}
							value={values.field}
							onChange={(field) => set({ field })}
						/>
						<Field>
							<FieldLabel htmlFor={`${id}-order`}>Order</FieldLabel>
							<NativeSelect
								id={`${id}-order`}
								className="w-full"
								value={values.order}
								onChange={(event) =>
									set({
										order: event.target.value as FormValues["order"],
									})
								}
							>
								<NativeSelectOption value="ascending">
									Lowest or earliest first
								</NativeSelectOption>
								<NativeSelectOption value="descending">
									Highest or latest first
								</NativeSelectOption>
							</NativeSelect>
						</Field>
					</>
				) : null}

				{preset === "limit" ? (
					<Field>
						<FieldLabel htmlFor={`${id}-count`}>How many to keep</FieldLabel>
						<Input
							id={`${id}-count`}
							type="number"
							min={1}
							className="w-24 tabular-nums"
							value={values.count}
							onChange={(event) =>
								set({ count: Math.max(1, Number(event.target.value) || 1) })
							}
						/>
					</Field>
				) : null}

				{preset === "unique" ? (
					<ItemField
						id={`${id}-field`}
						label="Items are the same when this matches"
						whole="The whole item"
						fields={fields}
						value={values.field}
						onChange={(field) => set({ field })}
					/>
				) : null}
			</FieldGroup>
			<DialogFooter>
				<DialogClose render={<Button variant="outline" type="button" />}>
					Cancel
				</DialogClose>
				<Button type="submit" disabled={input === null}>
					Use {meta?.label}
				</Button>
			</DialogFooter>
		</form>
	);
}

/**
 * One field of an item: a select of the fields the item's shape names,
 * else a text input. "" is the item itself.
 */
function ItemField({
	id,
	label,
	whole,
	fields,
	value,
	onChange,
}: {
	id: string;
	label: string;
	whole: string;
	fields: readonly string[];
	value: string;
	onChange: (field: string) => void;
}) {
	return (
		<Field>
			<FieldLabel htmlFor={id}>{label}</FieldLabel>
			{fields.length > 0 ? (
				<NativeSelect
					id={id}
					className="w-full font-mono"
					value={value}
					onChange={(event) => onChange(event.target.value)}
				>
					<NativeSelectOption value="">{whole}</NativeSelectOption>
					{fields.map((name) => (
						<NativeSelectOption key={name} value={name}>
							{name}
						</NativeSelectOption>
					))}
				</NativeSelect>
			) : (
				<Input
					id={id}
					className="font-mono"
					value={value}
					placeholder="title"
					onChange={(event) => onChange(event.target.value.trim())}
				/>
			)}
		</Field>
	);
}
