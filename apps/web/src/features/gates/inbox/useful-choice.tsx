import {
	ToggleGroup,
	ToggleGroupItem,
} from "@nightshift/ui/components/toggle-group";
import { useMutation } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";
import { runMutations } from "@/features/runs/queries";

import {
	knownUseful,
	rememberedUseful,
	rememberUseful,
	USEFUL_ERROR,
	USEFUL_HINT,
	usefulLabel,
	usefulView,
} from "./useful";

/**
 * One tap on a pull request in the morning digest. After it lands, the
 * row shows Yes or No and does not ask again.
 */
export function UsefulChoice({
	run,
}: {
	run: { runId: string; prUrl: string | null };
}) {
	const id = useId();
	const [sending, setSending] = useState<boolean | null>(null);
	const [failed, setFailed] = useState(false);
	const busy = useRef(false);
	const mark = useMutation(runMutations.useful());
	const known = knownUseful(run, rememberedUseful(run.runId));
	const view = usefulView(run, known);
	if (view === "hidden") return null;
	if (view !== "ask") {
		return <p className="pt-1.5 text-xs">{usefulLabel(view)}</p>;
	}

	const choose = (useful: boolean) => {
		if (busy.current) return;
		busy.current = true;
		setFailed(false);
		setSending(useful);
		mark.mutate(
			{ runId: run.runId, useful },
			{
				onSuccess: () => {
					rememberUseful(run.runId, useful);
					busy.current = false;
					setSending(null);
				},
				onError: () => {
					busy.current = false;
					setSending(null);
					setFailed(true);
				},
			},
		);
	};

	return (
		<div className="flex flex-col gap-1.5 pt-1.5">
			<p id={id} className="font-medium text-xs">
				Useful?
			</p>
			<ToggleGroup
				variant="outline"
				size="sm"
				spacing={0}
				aria-labelledby={id}
				aria-describedby={`${id}-hint`}
				aria-busy={sending !== null || undefined}
				disabled={sending !== null}
				value={sending === null ? [] : [sending ? "yes" : "no"]}
				onValueChange={(next) => {
					if (next[0] === "yes") choose(true);
					if (next[0] === "no") choose(false);
				}}
			>
				<ToggleGroupItem value="yes">Yes</ToggleGroupItem>
				<ToggleGroupItem value="no">No</ToggleGroupItem>
			</ToggleGroup>
			<p
				id={`${id}-hint`}
				role={failed ? "alert" : undefined}
				className={
					failed ? "text-destructive text-xs" : "text-muted-foreground text-xs"
				}
			>
				{failed ? USEFUL_ERROR : USEFUL_HINT}
			</p>
		</div>
	);
}
