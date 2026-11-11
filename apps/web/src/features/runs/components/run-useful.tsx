import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemMedia,
	ItemTitle,
} from "@nightshift/ui/components/item";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "@nightshift/ui/components/toggle-group";
import { useMutation } from "@tanstack/react-query";
import { GitPullRequestIcon } from "lucide-react";
import { useId, useRef, useState } from "react";

import type { RunDetail } from "@/shared/api";
import { runMutations } from "../queries";
import {
	knownUseful,
	rememberedUseful,
	rememberUseful,
	USEFUL_ERROR,
	USEFUL_HINT,
	USEFUL_QUESTION,
	usefulLabel,
	usefulView,
} from "../useful";

/**
 * One tap on the pull request a run opened: was it useful? It sits at the
 * end of the run's story. After it lands, it shows the choice and does not
 * ask again.
 */
export function RunUseful({ run }: { run: RunDetail }) {
	const id = useId();
	const [sending, setSending] = useState<boolean | null>(null);
	const [failed, setFailed] = useState(false);
	// Read again after a save, so the choice shows at once.
	const [, setSaved] = useState(0);
	const busy = useRef(false);
	const mark = useMutation(runMutations.useful());
	const prUrl = run.metrics?.prUrl ?? null;
	const known = knownUseful(run.metrics?.scores, rememberedUseful(run.id));
	const view = usefulView(prUrl, known);
	if (view === "hidden") return null;

	const choose = (useful: boolean) => {
		if (busy.current) return;
		busy.current = true;
		setFailed(false);
		setSending(useful);
		mark.mutate(
			{ runId: run.id, useful },
			{
				onSuccess: () => {
					rememberUseful(run.id, useful);
					busy.current = false;
					setSending(null);
					setSaved((n) => n + 1);
				},
				onError: () => {
					busy.current = false;
					setSending(null);
					setFailed(true);
				},
			},
		);
	};

	if (view !== "ask") {
		return (
			<Item variant="outline" size="sm">
				<ItemMedia variant="icon">
					<GitPullRequestIcon />
				</ItemMedia>
				<ItemContent>
					<ItemTitle>{usefulLabel(view)}</ItemTitle>
				</ItemContent>
			</Item>
		);
	}

	return (
		<Item variant="outline" size="sm">
			<ItemMedia variant="icon">
				<GitPullRequestIcon />
			</ItemMedia>
			<ItemContent>
				<ItemTitle id={id}>{USEFUL_QUESTION}</ItemTitle>
				<ItemDescription
					id={`${id}-hint`}
					role={failed ? "alert" : undefined}
					className={failed ? "text-destructive" : undefined}
				>
					{failed ? USEFUL_ERROR : USEFUL_HINT}
				</ItemDescription>
			</ItemContent>
			<ItemActions>
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
			</ItemActions>
		</Item>
	);
}
