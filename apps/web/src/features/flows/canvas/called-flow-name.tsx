/** The flow a Subflow node calls, on its card. */
import { Button } from "@nightshift/ui/components/button";
import { Kbd } from "@nightshift/ui/components/kbd";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { SquarePenIcon, WorkflowIcon } from "lucide-react";
import { useContext } from "react";
import { EnterSubflowContext, OpenFlowContext } from "./open-flow-context";

/**
 * The called flow's name. In the editor a click looks inside it, and a
 * button beside it opens its own editor. Plain text elsewhere.
 */
export function CalledFlowName({
	nodeId,
	name,
	prefix,
}: {
	nodeId: string;
	name: string;
	prefix: string;
}) {
	const openFlow = useContext(OpenFlowContext);
	const enterSubflow = useContext(EnterSubflowContext);
	return (
		<span className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
			<WorkflowIcon className="size-3 shrink-0" aria-hidden="true" />
			<span className="shrink-0">{prefix}</span>
			{name === "" ? (
				<span className="italic">no flow picked yet</span>
			) : enterSubflow ? (
				<>
					<Tooltip>
						<TooltipTrigger
							render={
								<Button
									variant="link"
									size="xs"
									className="nodrag nopan h-auto min-w-0 justify-start truncate px-0 font-mono text-[11px] text-foreground underline decoration-foreground/30 hover:decoration-foreground"
									onClick={(event) => {
										event.stopPropagation();
										enterSubflow(nodeId, name);
									}}
								/>
							}
						>
							<span className="truncate">{name}</span>
						</TooltipTrigger>
						<TooltipContent side="top">
							Look inside {name}
							<Kbd>I</Kbd>
						</TooltipContent>
					</Tooltip>
					{openFlow ? (
						<Tooltip>
							<TooltipTrigger
								render={
									<Button
										variant="ghost"
										size="icon-xs"
										className="nodrag nopan ml-auto size-5 shrink-0 text-muted-foreground"
										aria-label={`Edit ${name}`}
										onClick={(event) => {
											event.stopPropagation();
											openFlow(name);
										}}
									/>
								}
							>
								<SquarePenIcon />
							</TooltipTrigger>
							<TooltipContent side="top">Edit {name}</TooltipContent>
						</Tooltip>
					) : null}
				</>
			) : openFlow ? (
				<Button
					variant="link"
					size="xs"
					className="nodrag nopan h-auto min-w-0 justify-start truncate px-0 font-mono text-[11px] text-foreground underline decoration-foreground/30 hover:decoration-foreground"
					title={`Open the flow ${name}`}
					onClick={(event) => {
						event.stopPropagation();
						openFlow(name);
					}}
				>
					<span className="truncate">{name}</span>
				</Button>
			) : (
				<span className="min-w-0 truncate font-mono text-foreground">
					{name}
				</span>
			)}
		</span>
	);
}
