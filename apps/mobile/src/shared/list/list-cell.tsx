import { Card } from "@nightshift/ui-native/components/ui/card";
import { Separator } from "@nightshift/ui-native/components/ui/separator";
import { cn } from "@nightshift/ui-native/lib/utils";
import type { ReactNode } from "react";

/**
 * One row of a card in a list (FlashList), as its own piece of the Card:
 * the first piece has the round top, the last the round bottom. The rows
 * of a list look as the rows of a ListGroup do, but each one renders and
 * recycles on its own.
 */
export function ListCell({
	first,
	last,
	children,
}: {
	first: boolean;
	last: boolean;
	children: ReactNode;
}) {
	return (
		<Card
			className={cn(
				"gap-0 overflow-hidden rounded-none border-y-0 py-0 shadow-none",
				first && "rounded-t-xl border-t",
				last && "rounded-b-xl border-b",
			)}
		>
			{children}
		</Card>
	);
}

/**
 * The `ItemSeparatorComponent` of a list of ListCells: the Separator of a
 * ListGroup, between two rows of one card. After the last row of a card,
 * or after an item that is no row (a section head), it draws nothing.
 */
export function CellSeparator({ leadingItem }: { leadingItem?: unknown }) {
	const inCard =
		typeof leadingItem === "object" &&
		leadingItem !== null &&
		"last" in leadingItem &&
		leadingItem.last === false;
	if (!inCard) return null;
	return (
		<ListCell first={false} last={false}>
			<Separator />
		</ListCell>
	);
}
