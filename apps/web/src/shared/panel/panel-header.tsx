import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemMedia,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { cn } from "@nightshift/ui/lib/utils";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * The top of a side panel: what it shows, as a shadcn Item with an icon, a
 * small kicker, the name (in mono when it is an id), and the actions on it.
 */
export function PanelHeader({
	icon: Icon,
	kicker,
	title,
	badges,
	actions,
	mono = true,
	className,
}: {
	icon: LucideIcon;
	kicker: ReactNode;
	title: ReactNode;
	badges?: ReactNode;
	actions?: ReactNode;
	/** The title is an id, such as a flow or node name. */
	mono?: boolean;
	className?: string;
}) {
	return (
		<Item
			size="sm"
			className={cn("flex-nowrap rounded-none border-0 p-4", className)}
		>
			<ItemMedia
				variant="icon"
				className="size-9 rounded-lg border bg-muted text-muted-foreground"
			>
				<Icon aria-hidden="true" />
			</ItemMedia>
			<ItemContent className="min-w-0 gap-0.5">
				<ItemDescription className="flex items-center gap-1.5 text-xs uppercase tracking-wider">
					{kicker}
					{badges}
				</ItemDescription>
				<ItemTitle className={cn("block w-full truncate", mono && "font-mono")}>
					<h2 className="truncate">{title}</h2>
				</ItemTitle>
			</ItemContent>
			{actions ? <ItemActions className="gap-1">{actions}</ItemActions> : null}
		</Item>
	);
}
