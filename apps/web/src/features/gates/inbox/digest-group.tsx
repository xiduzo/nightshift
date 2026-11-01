import { type Digest, digestShown } from "@nightshift/client";
import {
	Item,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { Separator } from "@nightshift/ui/components/separator";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { notificationQueries } from "@/features/notifications";
import { formatTime } from "@/shared/format";
import { LocalTime } from "@/shared/time";

/**
 * The last morning digest on top of the inbox, as the phone shows it: its
 * sum, one row per run that ended before it, with its status, cost and
 * why it ended, and one per knowledge source that did not sync or is out
 * of date. Nothing when no digest went out in the last day.
 */
export function DigestGroup({ now }: { now: number }) {
	const digest = useQuery(notificationQueries.digest());
	const data = digest.data;
	if (!digestShown(data, now)) return null;
	return (
		<>
			<section aria-label="Your last digest" className="flex flex-col gap-2">
				<div className="px-2">
					<h2 className="font-medium text-sm">Your last digest</h2>
					<p className="text-muted-foreground text-xs">
						Sent at <LocalTime at={data.to}>{formatTime(data.to)}</LocalTime>
					</p>
				</div>
				<p className="px-2 text-muted-foreground text-xs">{data.body}</p>
				{data.runs.length > 0 || data.sources.length > 0 ? (
					<ItemGroup className="gap-0.5">
						{data.runs.map((run) => (
							<DigestRun key={run.runId} run={run} />
						))}
						{data.sources.map((source) => (
							<DigestKnowledgeSource
								key={`${source.projectId} ${source.title}`}
								source={source}
							/>
						))}
					</ItemGroup>
				) : null}
			</section>
			<Separator />
		</>
	);
}

function DigestRun({ run }: { run: Digest["runs"][number] }) {
	const facts = [
		run.statusText,
		run.prUrl ? "Opened a pull request" : null,
		run.detail,
	].filter(Boolean);
	return (
		<Item size="xs">
			<ItemContent className="min-w-0">
				<ItemTitle className="w-full min-w-0">
					<Link
						to="/runs/$runId"
						params={{ runId: run.runId }}
						className="truncate underline-offset-3 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
					>
						{run.title}
					</Link>
				</ItemTitle>
				<ItemDescription className="line-clamp-2 text-xs">
					{facts.join(" · ")}
				</ItemDescription>
			</ItemContent>
		</Item>
	);
}

function DigestKnowledgeSource({
	source,
}: {
	source: Digest["sources"][number];
}) {
	return (
		<Item size="xs">
			<ItemContent className="min-w-0">
				<ItemTitle className="w-full min-w-0">
					<Link
						to="/runs/$runId"
						params={{ runId: source.runId }}
						className="truncate underline-offset-3 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
					>
						{source.title}
					</Link>
				</ItemTitle>
				<ItemDescription className="text-xs">
					{source.statusText}
				</ItemDescription>
			</ItemContent>
		</Item>
	);
}
