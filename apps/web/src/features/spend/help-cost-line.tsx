import { Button } from "@nightshift/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { formatCost } from "@/shared/format";
import { spendQuery } from "./queries";

/**
 * One quiet sentence for another page: what Night Shift's own agents cost
 * this calendar month, with a link to the Spend page. Nothing while they
 * cost nothing, and nothing while the number loads.
 */
export function HelpCostLine() {
	const spend = useQuery(spendQuery());
	const cost = spend.data?.helpThisMonth ?? 0;
	if (cost <= 0) return null;
	return (
		<p className="flex flex-wrap items-baseline gap-x-1.5 text-muted-foreground text-sm">
			<span>Help cost {formatCost(cost)} this month.</span>
			<Button
				size="xs"
				variant="link"
				className="h-auto px-0"
				nativeButton={false}
				render={<Link to="/spend" />}
			>
				See it on Spend
			</Button>
		</p>
	);
}
