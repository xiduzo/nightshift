import { MinusIcon, TrendingDownIcon, TrendingUpIcon } from "lucide-react";

/** Which way a number moved against the nights before. */
export function TrendIcon({ trend }: { trend: "up" | "down" | "flat" }) {
	if (trend === "up") return <TrendingUpIcon aria-hidden="true" />;
	if (trend === "down") return <TrendingDownIcon aria-hidden="true" />;
	return <MinusIcon aria-hidden="true" />;
}
