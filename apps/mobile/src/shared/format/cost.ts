/** A cost and how sure it is, as the dashboard and a run carry it. */
export type KnownCost = {
	costUsd: number;
	/** Parts that ended without a cost: not in `costUsd`. */
	costMissing?: number;
};

/** "$2.93", "$0.0412" below a dollar, "—" when there is no cost. */
export function formatCost(usd: number | null | undefined): string {
	if (usd == null) return "—";
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: "USD",
		minimumFractionDigits: 2,
		maximumFractionDigits: usd > 0 && usd < 1 ? 4 : 2,
	}).format(usd);
}

/** "$2.93"; "$2.93+" when part of the cost is not known; "—" when none of it is. */
export function formatKnownCost(cost: KnownCost): string {
	const missing = cost.costMissing ?? 0;
	if (missing === 0) return formatCost(cost.costUsd);
	return cost.costUsd > 0 ? `${formatCost(cost.costUsd)}+` : "—";
}
