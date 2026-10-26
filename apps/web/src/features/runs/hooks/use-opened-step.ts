import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";

import type { StepSummary } from "@/shared/api";

import { runQueries } from "../queries";

/**
 * The step a person opened, with what the run's summary of it leaves out:
 * the prompt of each session and the element of each item (`runs.step`).
 * Until that loads, the summary as it is. A session or an item the read
 * does not have yet (a resume, the next item) reads the step again.
 */
export function useOpenedStep(runId: string, step: StepSummary): StepSummary {
	const wanted = step.sessions.length > 0 || step.items.length > 0;
	const detail = useQuery({
		...runQueries.step(runId, step.id),
		enabled: wanted,
		meta: { quietErrors: true },
	});
	const data = detail.data;
	const missing =
		data !== undefined &&
		(step.sessions.some((s) => !data.sessions.some((d) => d.id === s.id)) ||
			step.items.some((i) => !data.items.some((d) => d.id === i.id)));
	// Once per new session or item: a read that still lacks it does not loop.
	const lacking = missing
		? `${step.sessions.length}:${step.items.length}`
		: null;
	const { refetch } = detail;
	useEffect(() => {
		if (lacking !== null) void refetch();
	}, [lacking, refetch]);

	return useMemo(() => {
		if (!data) return step;
		const prompts = new Map(data.sessions.map((s) => [s.id, s.prompt]));
		const values = new Map(data.items.map((i) => [i.id, i.value]));
		return {
			...step,
			sessions: step.sessions.map((s) => ({
				...s,
				prompt: prompts.get(s.id) ?? s.prompt,
			})),
			items: step.items.map((i) => ({
				...i,
				value: values.has(i.id) ? values.get(i.id) : i.value,
			})),
		};
	}, [step, data]);
}
