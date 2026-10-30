/**
 * PROTOTYPE, throw away. The data every Home variant shares: the numbers
 * over all projects at the page's range, and the same per project (one
 * summary query each), so a variant can split a number by project.
 */

import {
	type ChartConfig,
	ChartContainer,
} from "@nightshift/ui/components/chart";
import { useQueries, useQuery } from "@tanstack/react-query";
import { MinusIcon, TrendingDownIcon, TrendingUpIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Line, LineChart, YAxis } from "recharts";
import { useOpenGates } from "@/features/gates";
import { projectQueries } from "@/features/projects";
import { runQueries } from "@/features/runs";
import type { NightRange, NightsRange, Project } from "@/shared/api";
import { formatCost } from "@/shared/format";
import { type Metric, type MetricRow, metricsOf } from "../metrics";
import { dashboardQueries } from "../queries";
import { nightsOf } from "../ranges";

export type Metrics = ReturnType<typeof metricsOf>;

export type ProjectNumbers = {
	project: Project;
	nights: NightsRange | undefined;
	metrics: Metrics | undefined;
};

export function useHomeData(range: NightRange) {
	const summary = useQuery(dashboardQueries.summary());
	const projects = useQuery(projectQueries.list());
	const gates = useOpenGates();
	// What is on its way now: at work, waiting at a Gate, or asleep.
	const openRuns = useQuery(runQueries.open());
	const perProject = useQueries({
		queries: (projects.data ?? []).map((project) =>
			dashboardQueries.summary({ projectId: project.id }),
		),
	});
	const nights = summary.data ? nightsOf(summary.data, range) : undefined;

	return {
		summary: summary.data,
		nights,
		metrics: nights ? metricsOf(nights) : undefined,
		projects: projects.data,
		gates: gates.data ?? [],
		openRuns: openRuns.data ?? [],
		perProject: (projects.data ?? []).map((project, index): ProjectNumbers => {
			const data = perProject[index]?.data;
			const projectNights = data ? nightsOf(data, range) : undefined;
			return {
				project,
				nights: projectNights,
				metrics: projectNights ? metricsOf(projectNights) : undefined,
			};
		}),
	};
}

/** How a number moved against the nights before, in a few words. */
export function changeOf(
	metric: Metric,
	value: number | null,
	before: number | null,
	compared: boolean,
): { icon: ReactNode; text: string; short: string } {
	if (!compared) {
		return {
			icon: <MinusIcon />,
			text: "Nothing to compare with yet",
			short: "new",
		};
	}
	if (value === null || before === null) {
		return { icon: <MinusIcon />, text: "No runs ended", short: "—" };
	}
	const delta = value - before;
	if (Math.abs(delta) < 0.005) {
		return {
			icon: <MinusIcon />,
			text: "Same as the nights before",
			short: "same",
		};
	}
	const amount =
		metric === "spend"
			? formatCost(Math.abs(delta))
			: metric === "finished"
				? `${Math.abs(delta)} pts`
				: String(Math.abs(delta));
	return {
		icon: delta > 0 ? <TrendingUpIcon /> : <TrendingDownIcon />,
		text: `${amount} ${delta > 0 ? "more" : "less"} than the nights before`,
		short: `${delta > 0 ? "+" : "−"}${amount}`,
	};
}

/** A small line of one metric per night, with the nights before dashed. */
export function Sparkline({
	rows,
	metric,
	color,
	compared,
	className = "h-10 w-full",
}: {
	rows: MetricRow[];
	metric: Metric;
	color: string;
	compared: boolean;
	className?: string;
}) {
	const config = {
		[metric]: { label: metric, color },
	} satisfies ChartConfig;
	return (
		<ChartContainer config={config} className={`aspect-auto ${className}`}>
			<LineChart data={rows} margin={{ top: 2, bottom: 2, left: 0, right: 0 }}>
				<YAxis hide domain={metric === "finished" ? [0, 100] : [0, "auto"]} />
				{compared ? (
					<Line
						dataKey={`before_${metric}`}
						type="monotone"
						stroke={color}
						strokeWidth={1}
						strokeDasharray="3 3"
						strokeOpacity={0.5}
						dot={false}
						connectNulls
						isAnimationActive={false}
					/>
				) : null}
				<Line
					dataKey={metric}
					type="monotone"
					stroke={color}
					strokeWidth={1.5}
					dot={false}
					connectNulls
					isAnimationActive={false}
				/>
			</LineChart>
		</ChartContainer>
	);
}
