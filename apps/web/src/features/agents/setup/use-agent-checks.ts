import type { BuiltinCheck } from "@nightshift/flows";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { builtinQueries } from "../queries";
import {
	type CheckRow,
	type CheckSummary,
	checkRows,
	checkSummary,
} from "./check-state";

/** One question of the check as the screen shows it. */
export type CheckedRow = {
	row: CheckRow;
	/** Null: not asked yet. */
	result: BuiltinCheck | null;
	asking: boolean;
	/** The check itself did not run: this computer did not answer. */
	error: string | null;
};

/**
 * The check of Night Shift's agents: its questions, the last result of
 * each, and `run`, which asks them all. The results are the ones "Try it"
 * shows: both read the same check of an agent. With `enabled` false it
 * asks this computer nothing.
 */
export function useAgentChecks(enabled = true): {
	loading: boolean;
	rows: CheckedRow[];
	summary: CheckSummary;
	asking: boolean;
	run: () => void;
} {
	const queryClient = useQueryClient();
	const statuses = useQuery({
		...builtinQueries.agents(),
		enabled,
		meta: { quietErrors: true },
	});
	const plan = useMemo(() => checkRows(statuses.data ?? []), [statuses.data]);
	const checks = useQueries({
		queries: plan.map((row) => builtinQueries.check(row.ask)),
	});
	const rows = plan.map((row, index): CheckedRow => {
		const check = checks[index];
		return {
			row,
			result: row.blocked ?? check?.data ?? null,
			asking: !row.blocked && check?.isFetching === true,
			error: row.blocked ? null : (check?.error?.message ?? null),
		};
	});
	const run = useCallback(() => {
		void (async () => {
			// Who answers can have changed: a new agent, a new model.
			const fresh = await queryClient
				.fetchQuery({ ...builtinQueries.agents(), staleTime: 0 })
				.catch(() => null);
			for (const row of checkRows(fresh ?? [])) {
				if (row.blocked) continue;
				void queryClient
					.fetchQuery({ ...builtinQueries.check(row.ask), staleTime: 0 })
					.catch(() => {});
			}
		})();
	}, [queryClient]);
	return {
		loading: enabled && statuses.isPending,
		rows,
		summary: checkSummary(rows.map((row) => row.result)),
		asking: rows.some((row) => row.asking),
		run,
	};
}
