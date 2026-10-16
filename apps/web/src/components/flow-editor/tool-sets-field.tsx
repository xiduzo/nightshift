import type { ToolSet } from "@nightshift/flows";
import { Checkbox } from "@nightshift/ui/components/checkbox";
import { Label } from "@nightshift/ui/components/label";

const TOOL_SETS: { value: ToolSet; label: string; hint: string }[] = [
	{
		value: "github",
		label: "github",
		hint: "Read issues and pull requests, comment, set labels, and open a pull request, through your own gh login.",
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
		<fieldset className="flex flex-col gap-1.5">
			<legend className="mb-1.5 text-xs leading-none">
				Tool sets <span className="text-muted-foreground">(optional)</span>
			</legend>
			{TOOL_SETS.map(({ value, label, hint }) => {
				const checked = tools.includes(value);
				return (
					<div key={value} className="flex items-start gap-2">
						<Checkbox
							id={`${id}-${value}`}
							checked={checked}
							className="mt-0.5"
							aria-describedby={`${id}-${value}-hint`}
							onCheckedChange={(next) =>
								onChange(
									next
										? [...tools.filter((tool) => tool !== value), value]
										: tools.filter((tool) => tool !== value),
								)
							}
						/>
						<div className="flex flex-col gap-0.5">
							<Label htmlFor={`${id}-${value}`} className="font-mono">
								{label}
							</Label>
							<p
								id={`${id}-${value}-hint`}
								className="text-muted-foreground text-xs"
							>
								{hint}
							</p>
						</div>
					</div>
				);
			})}
		</fieldset>
	);
}
