import { Button } from "@nightshift/ui/components/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@nightshift/ui/components/collapsible";
import { Separator } from "@nightshift/ui/components/separator";
import { cn } from "@nightshift/ui/lib/utils";
import { ChevronRightIcon } from "lucide-react";
import { type ReactNode, useId, useState } from "react";

/**
 * One section of a side panel: a separator, a small uppercase heading that
 * folds the section, and its contents. A button beside the heading, such as
 * Add, sits outside the fold trigger.
 */
export function PanelSection({
	title,
	aside,
	action,
	defaultOpen = true,
	contentClassName = "px-4 pt-1 pb-4",
	children,
}: {
	title: ReactNode;
	/** A badge or count beside the heading. */
	aside?: ReactNode;
	/** A button after the heading, such as Add. */
	action?: ReactNode;
	/** Closed at first: for settings that most people leave alone. */
	defaultOpen?: boolean;
	contentClassName?: string;
	children: ReactNode;
}) {
	const id = useId();
	const [open, setOpen] = useState(defaultOpen);
	return (
		<>
			<Separator />
			<Collapsible
				open={open}
				onOpenChange={setOpen}
				render={<section aria-labelledby={id} />}
			>
				<div className="relative">
					<h3 id={id}>
						<CollapsibleTrigger
							render={
								<Button
									variant="ghost"
									className={cn(
										"group/section h-12 w-full justify-start gap-2 rounded-none px-4",
										action && "pr-12",
									)}
								/>
							}
						>
							<ChevronRightIcon
								className="size-3.5 text-muted-foreground transition-transform group-data-panel-open/section:rotate-90 motion-reduce:transition-none"
								aria-hidden="true"
							/>
							<span className="flex-1 text-left font-medium text-muted-foreground text-xs uppercase tracking-wider">
								{title}
							</span>
							{aside}
						</CollapsibleTrigger>
					</h3>
					{action ? (
						<div className="absolute inset-y-0 right-2 flex items-center">
							{action}
						</div>
					) : null}
				</div>
				<CollapsibleContent className={contentClassName}>
					{children}
				</CollapsibleContent>
			</Collapsible>
		</>
	);
}
