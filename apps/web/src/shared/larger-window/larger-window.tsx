import { Button } from "@nightshift/ui/components/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@nightshift/ui/components/dialog";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { cn } from "@nightshift/ui/lib/utils";
import { Maximize2Icon } from "lucide-react";
import type { ReactNode, RefObject } from "react";

/** The classes of a field in the larger window: most of its height. */
export const LARGER_FIELD = "field-sizing-fixed h-[60vh] max-h-none";

/**
 * The button in a field's top right corner that opens it in a larger
 * window. Put it after the field, in a `relative` box, and give the field
 * `pr-9` so the text stays clear of it.
 */
export function LargerWindowButton({
	onClick,
	className,
}: {
	onClick: () => void;
	className?: string;
}) {
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						className={cn(
							"absolute top-1.5 right-1.5 text-muted-foreground",
							className,
						)}
						aria-label="Open in a larger window"
						onClick={onClick}
					/>
				}
			>
				<Maximize2Icon />
			</TooltipTrigger>
			<TooltipContent>Open in a larger window</TooltipContent>
		</Tooltip>
	);
}

/**
 * A large Dialog to edit one field in, with the field's label as its title
 * and Done to close it. The field goes in `children` while it is open, and
 * gets the focus. When the window closes, the focus goes back to the field
 * on the page. `footer` goes on the left of Done, such as a picker.
 */
export function LargerWindow({
	open,
	onOpenChange,
	title,
	field,
	footer,
	children,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: ReactNode;
	/** The field, on the page or in the window: it gets the focus. */
	field: RefObject<HTMLElement | null>;
	footer?: ReactNode;
	children: ReactNode;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				initialFocus={field}
				finalFocus={field}
				className="flex max-h-[90vh] flex-col sm:max-w-4xl"
			>
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
				</DialogHeader>
				{open ? (
					<div className="flex min-h-0 flex-col gap-2 overflow-y-auto">
						{children}
					</div>
				) : null}
				<DialogFooter className={footer ? "sm:justify-between" : undefined}>
					{footer}
					<DialogClose render={<Button type="button" />}>Done</DialogClose>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
