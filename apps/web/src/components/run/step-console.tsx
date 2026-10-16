import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import { ScrollArea } from "@nightshift/ui/components/scroll-area";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@nightshift/ui/components/tabs";
import { cn } from "@nightshift/ui/lib/utils";
import {
	BracesIcon,
	ChevronDownIcon,
	ChevronUpIcon,
	MessagesSquareIcon,
	ScrollTextIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import type { RunStatus, StepSummary } from "@/lib/api-types";

import { StepLine, StepOutputs, stepGist } from "./step-header";

/** The views of the selected step in the console. */
export type ConsoleTab = "summary" | "transcript" | "outputs";

/** The height of the closed console: its bar alone. */
export const CONSOLE_BAR_PX = 44;

/**
 * The selected step along the bottom of the run page, like a browser's
 * devtools. Closed, it is one line: the step and what it did in a few words.
 * Open, it shows the step's summary, its transcript (what the agent ran and
 * said), and its outputs.
 */
export function StepConsole({
	step,
	runStatus,
	open,
	onOpenChange,
	tab,
	onTabChange,
	summary,
	transcript,
	empty,
	className,
}: {
	step: StepSummary | undefined;
	runStatus: RunStatus;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	tab: ConsoleTab;
	onTabChange: (tab: ConsoleTab) => void;
	/** The Summary tab. */
	summary: ReactNode;
	/** The Transcript tab. */
	transcript: ReactNode;
	/** Shown in the bar while there is no step. */
	empty: string;
	className?: string;
}) {
	const outputCount = step ? Object.keys(step.outputs).length : 0;
	const gist = step ? stepGist(step) : undefined;

	return (
		<Tabs
			value={tab}
			onValueChange={(value) => onTabChange(value as ConsoleTab)}
			className={cn("gap-0 bg-background", className)}
		>
			<section
				aria-label="The selected step"
				className={cn(
					"flex h-11 shrink-0 items-center gap-3 px-4",
					open && "border-b",
				)}
			>
				{step ? (
					<>
						<div className="min-w-0 max-w-[50%] shrink-0">
							<StepLine step={step} runStatus={runStatus} />
						</div>
						{open ? (
							<div className="min-w-0 overflow-x-auto">
								<TabsList variant="line" className="h-11">
									<TabsTrigger value="summary">
										<ScrollTextIcon aria-hidden="true" />
										Summary
									</TabsTrigger>
									<TabsTrigger value="transcript">
										<MessagesSquareIcon aria-hidden="true" />
										Transcript
									</TabsTrigger>
									<TabsTrigger value="outputs">
										<BracesIcon aria-hidden="true" />
										Outputs
										{outputCount > 0 ? (
											<Badge variant="secondary" className="tabular-nums">
												{outputCount}
											</Badge>
										) : null}
									</TabsTrigger>
								</TabsList>
							</div>
						) : (
							<p
								className={cn(
									"min-w-0 flex-1 truncate text-xs",
									step.error ? "text-destructive" : "text-muted-foreground",
								)}
								title={gist}
							>
								{gist}
							</p>
						)}
						<Button
							variant="ghost"
							size="sm"
							className="ml-auto shrink-0"
							aria-expanded={open}
							onClick={() => onOpenChange(!open)}
						>
							{open ? (
								<ChevronDownIcon data-icon="inline-start" />
							) : (
								<ChevronUpIcon data-icon="inline-start" />
							)}
							{open ? "Hide" : "Details"}
						</Button>
					</>
				) : (
					<p className="text-muted-foreground text-xs">{empty}</p>
				)}
			</section>
			{open && step ? (
				<>
					<TabsContent value="summary" className="min-h-0 flex-1">
						<ScrollArea className="size-full">{summary}</ScrollArea>
					</TabsContent>
					<TabsContent
						value="transcript"
						className="flex min-h-0 flex-1 flex-col"
					>
						{transcript}
					</TabsContent>
					<TabsContent value="outputs" className="min-h-0 flex-1">
						<ScrollArea className="size-full">
							<StepOutputs step={step} />
						</ScrollArea>
					</TabsContent>
				</>
			) : null}
		</Tabs>
	);
}
