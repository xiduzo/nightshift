/** A Gate's deadline: when Night Shift stops waiting, and what it picks then. */
import type { DecisionNode, Flow, GateDeadline } from "@nightshift/flows";
import {
	FieldContent,
	FieldDescription,
	FieldLabel,
	Field as ShadcnField,
} from "@nightshift/ui/components/field";
import {
	NativeSelect,
	NativeSelectOption,
} from "@nightshift/ui/components/native-select";
import { Switch } from "@nightshift/ui/components/switch";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "@nightshift/ui/components/toggle-group";
import { useId } from "react";
import { Field, InspectorSection, PositiveIntInput } from "../fields";
import { TemplateField } from "../template-field";

/** A new deadline: 07:00, taking the last option (often the safe one). */
function newDeadline(node: DecisionNode): GateDeadline {
	return { at: "07:00", choose: node.options.at(-1)?.name ?? "" };
}

/** The deadline with `at` or `minutes` as its time, the other one gone. */
function withTime(
	deadline: GateDeadline,
	time: { at: string } | { minutes: number | undefined },
): GateDeadline {
	const { at: _, minutes: __, ...rest } = deadline;
	if ("at" in time) return { ...rest, at: time.at };
	return time.minutes === undefined ? rest : { ...rest, minutes: time.minutes };
}

export function GateDeadlineSection({
	flow,
	node,
	onChange,
}: {
	flow: Flow;
	node: DecisionNode;
	onChange: (change: (node: DecisionNode) => DecisionNode) => void;
}) {
	const id = useId();
	const { deadline } = node;
	const set = (next: GateDeadline | undefined) =>
		onChange(({ deadline: _, ...current }) =>
			next ? { ...current, deadline: next } : current,
		);
	const kind = deadline?.at !== undefined ? "time" : "minutes";
	const chosen = node.options.some((o) => o.name === deadline?.choose);

	return (
		<InspectorSection
			title="Deadline"
			tab="setup"
			defaultOpen={deadline !== undefined}
		>
			<ShadcnField orientation="horizontal" className="items-start">
				<Switch
					id={`${id}-on`}
					checked={deadline !== undefined}
					className="mt-0.5"
					aria-describedby={`${id}-on-hint`}
					onCheckedChange={(on) => set(on ? newDeadline(node) : undefined)}
				/>
				<FieldContent>
					<FieldLabel htmlFor={`${id}-on`}>
						Stop waiting at a deadline
					</FieldLabel>
					<FieldDescription id={`${id}-on-hint`} className="text-xs">
						When nobody answers in time, Night Shift picks an option for you.
					</FieldDescription>
				</FieldContent>
			</ShadcnField>
			{deadline ? (
				<>
					<Field id={`${id}-kind`} label="Deadline">
						<ToggleGroup
							variant="outline"
							size="sm"
							spacing={0}
							aria-label="Deadline"
							className="w-full"
							value={[kind]}
							onValueChange={(value) => {
								const next = value[0];
								if (next === "time") set(withTime(deadline, { at: "07:00" }));
								if (next === "minutes")
									set(withTime(deadline, { minutes: 60 }));
							}}
						>
							<ToggleGroupItem
								value="time"
								className="flex-1 aria-pressed:bg-primary aria-pressed:text-primary-foreground"
							>
								At a time
							</ToggleGroupItem>
							<ToggleGroupItem
								value="minutes"
								className="flex-1 aria-pressed:bg-primary aria-pressed:text-primary-foreground"
							>
								After minutes
							</ToggleGroupItem>
						</ToggleGroup>
					</Field>
					{kind === "time" ? (
						<TemplateField
							id={`${id}-at`}
							label="Time"
							hint="A time of day, such as 07:00, for the next one after the Gate opens. Or a date and time, such as 2026-10-18T07:00."
							flow={flow}
							nodeId={node.id}
							value={deadline.at ?? ""}
							placeholder="07:00"
							multiline={false}
							invalid={(deadline.at ?? "").trim() === ""}
							onChange={(at) => set(withTime(deadline, { at }))}
						/>
					) : (
						<Field
							id={`${id}-minutes`}
							label="Minutes after the Gate opens"
							hint="For example 90. A whole number above 0."
						>
							<PositiveIntInput
								id={`${id}-minutes`}
								value={deadline.minutes}
								placeholder="60"
								describedBy={`${id}-minutes-hint`}
								onChange={(minutes) => set(withTime(deadline, { minutes }))}
							/>
						</Field>
					)}
					<Field
						id={`${id}-choose`}
						label="Then pick"
						hint="The option Night Shift picks. The note says the deadline chose it."
						error={chosen ? null : "Pick one of the Gate's options."}
					>
						<NativeSelect
							id={`${id}-choose`}
							value={chosen ? deadline.choose : ""}
							aria-invalid={!chosen}
							aria-describedby={`${id}-choose-hint`}
							onChange={(event) =>
								set({ ...deadline, choose: event.target.value })
							}
						>
							{chosen ? null : (
								<NativeSelectOption value="" disabled>
									Choose an option
								</NativeSelectOption>
							)}
							{node.options.map((option) => (
								<NativeSelectOption key={option.name} value={option.name}>
									{option.name}
								</NativeSelectOption>
							))}
						</NativeSelect>
					</Field>
				</>
			) : null}
		</InspectorSection>
	);
}
