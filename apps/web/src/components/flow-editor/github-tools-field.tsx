import type { ToolSet } from "@nightshift/flows";
import { Checkbox } from "@nightshift/ui/components/checkbox";
import { Label } from "@nightshift/ui/components/label";
import { GitPullRequestIcon } from "lucide-react";

/** Turns the `github` tool set on or off for an Agent or a Decision node. */
export function GitHubToolsField({
	id,
	tools,
	onChange,
}: {
	id: string;
	tools: readonly ToolSet[];
	onChange: (tools: ToolSet[]) => void;
}) {
	const checked = tools.includes("github");
	return (
		<div className="flex items-start gap-2">
			<Checkbox
				id={id}
				checked={checked}
				className="mt-0.5"
				aria-describedby={`${id}-hint`}
				onCheckedChange={(next) =>
					onChange(
						next
							? [...tools.filter((tool) => tool !== "github"), "github"]
							: tools.filter((tool) => tool !== "github"),
					)
				}
			/>
			<div className="flex flex-col gap-0.5">
				<Label htmlFor={id} className="flex items-center gap-1">
					<GitPullRequestIcon
						className="size-3.5 text-muted-foreground"
						aria-hidden="true"
					/>
					GitHub tools
				</Label>
				<p id={`${id}-hint`} className="text-muted-foreground text-xs">
					Read issues and pull requests, comment, set labels, and open a pull
					request, through your own <code className="font-mono">gh</code> login.
				</p>
			</div>
		</div>
	);
}
