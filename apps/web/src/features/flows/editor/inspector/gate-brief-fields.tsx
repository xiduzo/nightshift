/**
 * The brief of a Gate (ADR 21): how urgent it is, why a person must
 * decide, what is already done, and the option the flow recommends. A
 * Decision decided by a person, the person tier of a cascade and an Ask
 * set it. What the author leaves empty, Night Shift may write as the Gate
 * opens (`fillBrief`, on by default).
 */
import {
	type Flow,
	GATE_URGENCIES,
	type GateBriefFields,
	type GateUrgency,
	isGateUrgency,
} from "@nightshift/flows";
import {
	FieldLabel,
	Field as ShadcnField,
} from "@nightshift/ui/components/field";
import {
	NativeSelect,
	NativeSelectOption,
} from "@nightshift/ui/components/native-select";
import { Switch } from "@nightshift/ui/components/switch";
import { useId, useState } from "react";
import { Field, InspectorSection } from "../fields";
import type { InspectorTab } from "../inspector-tabs";
import { TemplateField } from "../template-field";

/** The names the inbox gives the urgencies. */
const URGENCY_LABEL: Record<GateUrgency, string> = {
	now: "Now",
	today: "Today",
	later: "When you have time",
};

const BRIEF_KEYS = [
	"urgency",
	"situation",
	"background",
	"recommend",
	"fillBrief",
] as const;

type BriefChange = (fields: GateBriefFields) => GateBriefFields;

/** The select value that shows a template field. */
const TEMPLATE = "template";

const hasTemplate = (text: string) => text.includes("{{");

/** `target` with its brief fields changed; a field set to undefined goes. */
export function withBrief<T extends GateBriefFields>(
	target: T,
	change: BriefChange,
): T {
	const current: GateBriefFields = {};
	const rest: Record<string, unknown> = { ...(target as object) };
	for (const key of BRIEF_KEYS) {
		if (target[key] !== undefined)
			Object.assign(current, { [key]: target[key] });
		delete rest[key];
	}
	const next = Object.fromEntries(
		Object.entries(change(current)).filter(([, value]) => value !== undefined),
	);
	return { ...rest, ...next } as T;
}

/** One brief field set, or cleared when `value` is undefined. */
function set<K extends keyof GateBriefFields>(
	key: K,
	value: GateBriefFields[K],
): BriefChange {
	return (fields) => ({ ...fields, [key]: value });
}

/** Empty text clears the field. */
const text = (value: string) => (value.trim() === "" ? undefined : value);

/**
 * The brief section. `options` are the Decision's options a recommendation
 * may name; null where nothing may be recommended (an Ask, the person tier
 * of an Agent).
 */
export function GateBriefSection({
	flow,
	nodeId,
	fields,
	options,
	tab = "work",
	onChange,
}: {
	flow: Flow;
	nodeId: string;
	fields: GateBriefFields;
	options: readonly string[] | null;
	tab?: InspectorTab;
	onChange: (change: BriefChange) => void;
}) {
	const id = useId();
	const anySet = BRIEF_KEYS.some((key) => fields[key] !== undefined);
	return (
		<InspectorSection title="Brief" tab={tab} defaultOpen={anySet}>
			<UrgencyField
				id={`${id}-urgency`}
				flow={flow}
				nodeId={nodeId}
				urgency={fields.urgency}
				onChange={(urgency) => onChange(set("urgency", urgency))}
			/>
			<TemplateField
				id={`${id}-situation`}
				label="Situation"
				flow={flow}
				nodeId={nodeId}
				value={fields.situation ?? ""}
				className="font-sans text-sm"
				placeholder="The tests pass, but the change touches billing."
				onChange={(value) => onChange(set("situation", text(value)))}
			/>
			<TemplateField
				id={`${id}-background`}
				label="Background"
				hint='Start a line with "- " to make it one item. End an item with (source: X) to show where it comes from.'
				flow={flow}
				nodeId={nodeId}
				value={fields.background ?? ""}
				className="font-sans text-sm"
				placeholder={"- The tests pass (source: CI)\n- {{review.summary}}"}
				onChange={(value) => onChange(set("background", text(value)))}
			/>
			{options ? (
				<RecommendFields
					id={`${id}-recommend`}
					flow={flow}
					nodeId={nodeId}
					fields={fields}
					options={options}
					onChange={onChange}
				/>
			) : null}
			<ShadcnField orientation="horizontal">
				<Switch
					id={`${id}-fill`}
					checked={fields.fillBrief !== false}
					onCheckedChange={(on) =>
						onChange(set("fillBrief", on ? undefined : false))
					}
				/>
				<FieldLabel htmlFor={`${id}-fill`}>
					Night Shift writes what you leave empty
				</FieldLabel>
			</ShadcnField>
		</InspectorSection>
	);
}

/**
 * How urgent the Gate is: one of the three, Night Shift's pick (unset),
 * or a template that gives one.
 */
function UrgencyField({
	id,
	flow,
	nodeId,
	urgency,
	onChange,
}: {
	id: string;
	flow: Flow;
	nodeId: string;
	urgency: string | undefined;
	onChange: (urgency: string | undefined) => void;
}) {
	const level = urgency !== undefined && isGateUrgency(urgency.trim());
	// Template mode stays while its text is empty.
	const [templating, setTemplating] = useState(urgency !== undefined && !level);
	const mode =
		urgency !== undefined && level
			? urgency.trim()
			: templating || urgency !== undefined
				? TEMPLATE
				: "";
	const value = urgency ?? "";
	const invalid =
		mode === TEMPLATE && value.trim() !== "" && !hasTemplate(value) && !level;
	return (
		<>
			<Field id={id} label="Urgency">
				<NativeSelect
					id={id}
					value={mode}
					onChange={(event) => {
						const next = event.target.value;
						setTemplating(next === TEMPLATE);
						if (next === TEMPLATE) onChange(undefined);
						else onChange(next === "" ? undefined : next);
					}}
				>
					{GATE_URGENCIES.map((each) => (
						<NativeSelectOption key={each} value={each}>
							{URGENCY_LABEL[each]}
						</NativeSelectOption>
					))}
					<NativeSelectOption value="">
						Let Night Shift decide
					</NativeSelectOption>
					<NativeSelectOption value={TEMPLATE}>
						From a template
					</NativeSelectOption>
				</NativeSelect>
			</Field>
			{mode === TEMPLATE ? (
				<TemplateField
					id={`${id}-template`}
					label="Urgency template"
					hint="It gives now, today or later. Night Shift decides when it gives something else."
					flow={flow}
					nodeId={nodeId}
					value={value}
					multiline={false}
					invalid={invalid}
					error={
						invalid
							? "Use now, today or later, or a template such as {{triage.data.urgency}}."
							: null
					}
					placeholder="{{triage.data.urgency}}"
					onChange={(next) => onChange(text(next))}
				/>
			) : null}
		</>
	);
}

/** The option the flow recommends, from the list or a template, and why. */
function RecommendFields({
	id,
	flow,
	nodeId,
	fields,
	options,
	onChange,
}: {
	id: string;
	flow: Flow;
	nodeId: string;
	fields: GateBriefFields;
	options: readonly string[];
	onChange: (change: BriefChange) => void;
}) {
	const { recommend } = fields;
	const option = recommend?.option ?? "";
	const [templating, setTemplating] = useState(hasTemplate(option));
	const literal = recommend !== undefined && !hasTemplate(option);
	const known = literal && options.includes(option.trim());
	const mode = templating
		? TEMPLATE
		: known
			? option.trim()
			: literal
				? "unknown"
				: "";
	const setOption = (next: string | undefined) =>
		onChange((current) => {
			if (next === undefined) {
				const { recommend: _, ...rest } = current;
				return rest;
			}
			return {
				...current,
				recommend: { ...current.recommend, option: next },
			};
		});
	return (
		<>
			<Field
				id={id}
				label="Recommend"
				error={mode === "unknown" ? "Pick one of the options." : null}
			>
				<NativeSelect
					id={id}
					value={mode}
					aria-invalid={mode === "unknown"}
					aria-describedby={`${id}-hint`}
					onChange={(event) => {
						const next = event.target.value;
						setTemplating(next === TEMPLATE);
						if (next === TEMPLATE) {
							// Keeps the reason until a template is written.
							if (!hasTemplate(option)) setOption(undefined);
						} else setOption(next === "" ? undefined : next);
					}}
				>
					{mode === "unknown" ? (
						<NativeSelectOption value="unknown" disabled>
							{option}
						</NativeSelectOption>
					) : null}
					<NativeSelectOption value="">No recommendation</NativeSelectOption>
					{options.map((each) => (
						<NativeSelectOption key={each} value={each}>
							{each}
						</NativeSelectOption>
					))}
					<NativeSelectOption value={TEMPLATE}>
						From a template
					</NativeSelectOption>
				</NativeSelect>
			</Field>
			{mode === TEMPLATE ? (
				<TemplateField
					id={`${id}-template`}
					label="Option template"
					hint="It gives the name of an option. Night Shift leaves the recommendation out when it gives something else."
					flow={flow}
					nodeId={nodeId}
					value={option}
					multiline={false}
					placeholder="{{triage.data.pick}}"
					onChange={(next) => setOption(text(next))}
				/>
			) : null}
			{recommend ? (
				<TemplateField
					id={`${id}-reason`}
					label="Reason"
					flow={flow}
					nodeId={nodeId}
					value={recommend.reason ?? ""}
					multiline={false}
					placeholder="The change is small and the tests pass."
					onChange={(next) =>
						onChange((current) => {
							if (!current.recommend) return current;
							const { reason: _, ...rest } = current.recommend;
							const reason = text(next);
							return {
								...current,
								recommend: reason === undefined ? rest : { ...rest, reason },
							};
						})
					}
				/>
			) : null}
		</>
	);
}
