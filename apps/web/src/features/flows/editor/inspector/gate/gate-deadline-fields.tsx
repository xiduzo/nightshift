/** A Gate's deadline: when Night Shift stops waiting, and what it picks then. */
import type { DecisionNode, Flow, GateDeadline } from "@nightshift/flows";
import {
	NativeSelect,
	NativeSelectOption,
} from "@nightshift/ui/components/native-select";
import { useId } from "react";
import {
	ChoiceField,
	Field,
	InspectorSection,
	NumberField,
	SwitchField,
	withOptional,
} from "../form";
import { TemplateField } from "../template";

const DEADLINE_KINDS = [
	{ value: "time", label: "At a time" },
	{ value: "minutes", label: "After minutes" },
] as const;

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
		onChange((current) => withOptional(current, "deadline", next));
	const kind = deadline?.at !== undefined ? "time" : "minutes";
	const chosen = node.options.some((o) => o.name === deadline?.choose);

	return (
		<InspectorSection
			title="Deadline"
			tab="setup"
			defaultOpen={deadline !== undefined}
		>
			<SwitchField
				id={`${id}-on`}
				label="Stop waiting at a deadline"
				description="When nobody answers in time, Night Shift picks an option for you."
				checked={deadline !== undefined}
				onChange={(on) => set(on ? newDeadline(node) : undefined)}
			/>
			{deadline ? (
				<>
					<ChoiceField
						id={`${id}-kind`}
						label="Deadline"
						value={kind}
						choices={DEADLINE_KINDS}
						onChange={(next) =>
							set(
								withTime(
									deadline,
									next === "time" ? { at: "07:00" } : { minutes: 60 },
								),
							)
						}
					/>
					{kind === "time" ? (
						<TemplateField
							id={`${id}-at`}
							label="Time"
							hint="A time of day, such as 07:00, means the next one after the Gate opens. Or give a date and time: 2026-10-18T07:00."
							flow={flow}
							nodeId={node.id}
							value={deadline.at ?? ""}
							placeholder="07:00"
							multiline={false}
							invalid={(deadline.at ?? "").trim() === ""}
							onChange={(at) => set(withTime(deadline, { at }))}
						/>
					) : (
						<NumberField
							id={`${id}-minutes`}
							label="Minutes after the Gate opens"
							hint="A whole number above 0."
							value={deadline.minutes}
							placeholder="60"
							onChange={(minutes) => set(withTime(deadline, { minutes }))}
						/>
					)}
					<Field
						id={`${id}-choose`}
						label="Then pick"
						hint="The note says that the deadline picked this option."
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
