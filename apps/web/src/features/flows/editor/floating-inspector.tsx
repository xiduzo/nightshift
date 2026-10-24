import { Button } from "@nightshift/ui/components/button";
import { Card } from "@nightshift/ui/components/card";
import { ScrollArea } from "@nightshift/ui/components/scroll-area";
import { cn } from "@nightshift/ui/lib/utils";
import { XIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * The inspector as a card that floats over the canvas: a slim bar with what
 * it shows and a close button, and its fields below. It grows with its
 * fields and scrolls once it reaches the bottom of the canvas.
 */
export function FloatingInspector({
	label,
	onClose,
	children,
	className,
}: {
	label: string;
	onClose: () => void;
	children: ReactNode;
	className?: string;
}) {
	return (
		<aside
			aria-label="Inspector"
			className={cn("flex max-h-full min-h-0 flex-col", className)}
		>
			<Card className="flex max-h-full min-h-0 flex-col gap-0 py-0 shadow-lg">
				<div className="flex h-9 shrink-0 items-center gap-2 border-b pr-1.5 pl-3 text-muted-foreground text-xs">
					<span className="min-w-0 flex-1 truncate">{label}</span>
					<Button
						variant="ghost"
						size="icon-xs"
						aria-label="Close"
						title="Close (Esc)"
						onClick={onClose}
					>
						<XIcon />
					</Button>
				</div>
				<ScrollArea className="min-h-0 flex-1">{children}</ScrollArea>
			</Card>
		</aside>
	);
}
