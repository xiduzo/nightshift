import { Card } from "@nightshift/ui-native/components/ui/card";
import { Separator } from "@nightshift/ui-native/components/ui/separator";
import { cn } from "@nightshift/ui-native/lib/utils";
import {
	Children,
	Fragment,
	isValidElement,
	type ReactElement,
	type ReactNode,
} from "react";

/**
 * Rows in one Card, split by Separators: the shadcn list in a card. Put
 * ListRows in it. Empty children (null, false) leave no gap.
 */
export function ListGroup({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	const rows = Children.toArray(children).filter(
		(child): child is ReactElement => isValidElement(child),
	);
	return (
		<Card className={cn("gap-0 overflow-hidden py-0", className)}>
			{rows.map((row, index) => (
				<Fragment key={row.key ?? index}>
					{index > 0 ? <Separator /> : null}
					{row}
				</Fragment>
			))}
		</Card>
	);
}
