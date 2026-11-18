import type { CascadeNode, PersonTier } from "@nightshift/flows";
import {
	NativeSelect,
	NativeSelectOption,
} from "@nightshift/ui/components/native-select";
import { Field, PositiveIntInput } from "../form";

/** The choices of the person tier of an Agent or a Subflow. */
const RETRY_CHOICES = [
	{ name: "try-again", label: "Try again" },
	{ name: "stop", label: "Stop" },
] as const;

/** What the deadline of a Value's person tier takes: the best answer, or a fail. */
const ASK_CHOICES = [
	{ name: "accept", label: "Take the best answer" },
	{ name: "fail", label: "Fail the step" },
] as const;

/** When the person tier stops waiting, and what it chooses then. */
export function PersonDeadline<N extends CascadeNode>({
	id,
	node,
	tier,
	onChange,
}: {
	id: string;
	node: N;
	tier: PersonTier;
	onChange: (deadline: PersonTier["deadline"]) => void;
}) {
	const choices =
		node.type === "decision"
			? node.options.map((option) => ({
					name: option.name,
					label: option.name,
				}))
			: node.type === "value"
				? ASK_CHOICES
				: RETRY_CHOICES;
	const deadline = tier.deadline;
	return (
		<div className="grid grid-cols-2 gap-3">
			<Field
				id={`${id}-minutes`}
				label="Choose after (min)"
				optional
				hint="When you do not answer in time, Night Shift chooses for you."
			>
				<PositiveIntInput
					id={`${id}-minutes`}
					value={deadline?.minutes}
					placeholder="None"
					describedBy={`${id}-minutes-hint`}
					onChange={(minutes) =>
						onChange(
							minutes === undefined
								? undefined
								: {
										minutes,
										choose: deadline?.choose ?? choices[0]?.name ?? "stop",
									},
						)
					}
				/>
			</Field>
			<Field id={`${id}-choose`} label="Then choose">
				<NativeSelect
					id={`${id}-choose`}
					value={deadline?.choose ?? ""}
					disabled={deadline === undefined}
					onChange={(event) =>
						deadline && onChange({ ...deadline, choose: event.target.value })
					}
				>
					{deadline === undefined ? (
						<NativeSelectOption value="">Set a time first</NativeSelectOption>
					) : null}
					{choices.map((choice) => (
						<NativeSelectOption key={choice.name} value={choice.name}>
							{choice.label}
						</NativeSelectOption>
					))}
				</NativeSelect>
			</Field>
		</div>
	);
}
