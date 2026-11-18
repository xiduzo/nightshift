import type { FlowIssue } from "@nightshift/flows";
import { Badge } from "@nightshift/ui/components/badge";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { cn } from "@nightshift/ui/lib/utils";
import { CircleAlertIcon, TriangleAlertIcon } from "lucide-react";

/**
 * The count of a node's errors, or of its warnings when it has none. Its
 * tooltip lists every issue of the node, errors first.
 */
export function IssueBadge({
	errors,
	warnings,
}: {
	errors: readonly FlowIssue[];
	warnings: readonly FlowIssue[];
}) {
	const isError = errors.length > 0;
	const count = isError ? errors.length : warnings.length;
	const Icon = isError ? CircleAlertIcon : TriangleAlertIcon;
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Badge
						variant={isError ? "destructive" : "outline"}
						className={cn(
							"h-4 gap-0.5 px-1.5 text-[10px] tabular-nums",
							!isError &&
								"border-status-waiting bg-status-waiting text-background",
						)}
					/>
				}
			>
				<Icon aria-hidden="true" />
				<span className="sr-only">{isError ? "Errors:" : "Warnings:"}</span>
				{count}
			</TooltipTrigger>
			<TooltipContent side="top" className="max-w-72">
				<ul className="flex flex-col gap-1">
					{[...errors, ...warnings].map((issue, index) => {
						const IssueIcon =
							issue.severity === "error" ? CircleAlertIcon : TriangleAlertIcon;
						return (
							<li
								// The same message can come twice.
								key={`${issue.severity}:${issue.message}:${index}`}
								className="flex items-start gap-1.5"
							>
								<IssueIcon
									className={cn(
										"mt-0.5 size-3 shrink-0",
										issue.severity === "error"
											? "text-destructive"
											: "text-status-waiting",
									)}
									aria-hidden="true"
								/>
								<span>{issue.message}</span>
							</li>
						);
					})}
				</ul>
			</TooltipContent>
		</Tooltip>
	);
}
