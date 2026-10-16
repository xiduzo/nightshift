import type { ToolSet } from "@nightshift/flows";
import { Checkbox } from "@nightshift/ui/components/checkbox";
import {
	Field,
	FieldContent,
	FieldDescription,
	FieldLabel,
	FieldLegend,
	FieldSet,
} from "@nightshift/ui/components/field";

const TOOL_SETS: { value: ToolSet; label: string; hint: string }[] = [
	{
		value: "github",
		label: "github",
		hint: "Read issues and pull requests, comment, set labels, and open pull requests with your GitHub account.",
	},
];

/** The tool sets an Agent or a Decision node gets on top of the harness's own tools. */
export function ToolSetsField({
	id,
	tools,
	onChange,
}: {
	id: string;
	tools: readonly ToolSet[];
	onChange: (tools: ToolSet[]) => void;
}) {
	return (
		<FieldSet className="gap-3">
			<FieldLegend variant="label" className="sr-only">
				Tool sets (optional)
			</FieldLegend>
			{TOOL_SETS.map(({ value, label, hint }) => {
				const checked = tools.includes(value);
				return (
					<Field key={value} orientation="horizontal">
						<Checkbox
							id={`${id}-${value}`}
							checked={checked}
							aria-describedby={`${id}-${value}-hint`}
							onCheckedChange={(next) =>
								onChange(
									next
										? [...tools.filter((tool) => tool !== value), value]
										: tools.filter((tool) => tool !== value),
								)
							}
						/>
						<FieldContent>
							<FieldLabel htmlFor={`${id}-${value}`} className="font-mono">
								{label}
							</FieldLabel>
							<FieldDescription id={`${id}-${value}-hint`} className="text-xs">
								{hint}
							</FieldDescription>
						</FieldContent>
					</Field>
				);
			})}
		</FieldSet>
	);
}
