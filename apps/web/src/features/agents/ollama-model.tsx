import { Button } from "@nightshift/ui/components/button";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { Progress } from "@nightshift/ui/components/progress";
import { Spinner } from "@nightshift/ui/components/spinner";
import { useMutation, useQuery } from "@tanstack/react-query";
import { DownloadIcon } from "lucide-react";
import { toast } from "sonner";
import { ollamaMutations, ollamaQueries } from "@/features/settings/queries";

/** How often the status is asked again while the model downloads. */
const DOWNLOAD_POLL_MS = 1_500;

/**
 * The model of a Model Profile on Ollama on this computer: its Download
 * button while Ollama lacks it, then how far the download is. Nothing when
 * Ollama has it, or does not answer: a step says so when it runs.
 */
export function OllamaModelLine({ model }: { model: string }) {
	const status = useQuery({
		...ollamaQueries.status(model),
		refetchInterval: (query) =>
			query.state.data?.download?.running ? DOWNLOAD_POLL_MS : false,
		meta: { quietErrors: true },
	});
	const pull = useMutation(
		ollamaMutations.pull({
			onError: (error) => toast.error(`Not downloaded: ${error.message}`),
		}),
	);
	const s = status.data;
	if (!s?.answers || s.hasModel) return null;
	const running = s.download?.running ?? false;
	const percent = s.download?.percent ?? 0;

	return (
		<Item variant="muted" size="sm">
			<ItemContent>
				<ItemTitle>{model} is not on this computer</ItemTitle>
				<ItemDescription>
					{running
						? `Night Shift downloads it: ${percent}%.`
						: s.download?.error
							? "The download stopped. Try again."
							: "Download it before a step uses this profile."}
				</ItemDescription>
				{running ? (
					<Progress
						value={percent}
						aria-label={`Download of ${model}`}
						className="mt-2"
					/>
				) : null}
			</ItemContent>
			{running ? null : (
				<ItemActions>
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={pull.isPending}
						onClick={() => pull.mutate({ model })}
					>
						{pull.isPending ? (
							<Spinner data-icon="inline-start" />
						) : (
							<DownloadIcon data-icon="inline-start" />
						)}
						Download
					</Button>
				</ItemActions>
			)}
		</Item>
	);
}
