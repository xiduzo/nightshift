import type { Digest, DigestEntry } from "@nightshift/client";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import {
	Item,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { Separator } from "@nightshift/ui/components/separator";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { cn } from "@nightshift/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CircleAlertIcon, SunriseIcon } from "lucide-react";
import { useEffect } from "react";
import {
	notificationMutations,
	notificationQueries,
} from "@/features/notifications";
import { formatDayTime } from "@/shared/format";
import { LocalTime } from "@/shared/time";
import { UsefulChoice } from "./useful-choice";

/**
 * Your digests of the last 90 days in the list, newest first, as a mail
 * app shows mail: what each said, and a dot until you open it.
 */
export function DigestNavList({
	entries,
	selectedKey,
	onSelect,
}: {
	entries: readonly DigestEntry[];
	selectedKey: string | undefined;
	onSelect: (key: string) => void;
}) {
	return (
		<ItemGroup className="gap-0.5">
			{entries.map((entry) => {
				const selected = entry.key === selectedKey;
				return (
					<Item
						key={entry.key}
						size="xs"
						variant={selected ? "muted" : "default"}
						render={
							<button
								type="button"
								className="text-left"
								aria-current={selected ? "page" : undefined}
							/>
						}
						onClick={() => onSelect(entry.key)}
					>
						<ItemMedia className="self-start pt-1.5">
							<span
								aria-hidden="true"
								className={cn(
									"size-2 rounded-full",
									entry.read ? "bg-transparent" : "bg-primary",
								)}
							/>
						</ItemMedia>
						<ItemContent className="min-w-0">
							<ItemTitle
								className={cn(
									"w-full justify-between gap-2",
									entry.read ? "font-normal" : "font-semibold",
								)}
							>
								<span className="truncate">
									{entry.read ? null : (
										<span className="sr-only">Unread: </span>
									)}
									{entry.title}
								</span>
								<LocalTime
									at={entry.at}
									className="shrink-0 font-normal text-muted-foreground text-xs tabular-nums"
								>
									{formatDayTime(entry.at)}
								</LocalTime>
							</ItemTitle>
							<ItemDescription className="line-clamp-2 text-xs">
								{entry.body}
							</ItemDescription>
						</ItemContent>
					</Item>
				);
			})}
		</ItemGroup>
	);
}

/**
 * One digest in the pane: what it said, and one row per run that ended
 * before it, with its status, cost and why it ended. The newest one also
 * shows the knowledge sources that need you now. Opening it marks it read.
 */
export function DigestDetail({
	entry,
	newest,
}: {
	entry: DigestEntry;
	newest: boolean;
}) {
	const queryClient = useQueryClient();
	const { mutate: markRead } = useMutation(
		notificationMutations.markDigestRead({
			onSuccess: () =>
				queryClient.invalidateQueries({
					queryKey: notificationQueries.digests().queryKey,
				}),
		}),
	);
	useEffect(() => {
		if (!entry.read) markRead({ key: entry.key });
	}, [entry.key, entry.read, markRead]);

	// The newest digest reads what needs you now. An older one shows its runs.
	const latest = useQuery({ ...notificationQueries.digest(), enabled: newest });
	const past = useQuery({
		...notificationQueries.digestOf(entry.key),
		enabled: !newest,
	});
	const digest = newest ? latest : past;

	return (
		<div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 pt-8 pb-16 md:px-8">
			<header className="flex items-start gap-4">
				<div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground [&_svg]:size-5">
					<SunriseIcon aria-hidden="true" />
				</div>
				<div className="flex min-w-0 flex-1 flex-col gap-1.5">
					<p className="text-muted-foreground text-xs">
						Sent <LocalTime at={entry.at}>{formatDayTime(entry.at)}</LocalTime>
					</p>
					<h1 className="font-semibold text-xl leading-snug tracking-tight">
						{entry.title}
					</h1>
					<p className="text-muted-foreground text-sm">{entry.body}</p>
				</div>
			</header>
			<Separator />
			{digest.isLoading ? (
				<div className="flex flex-col gap-2" aria-hidden>
					<Skeleton className="h-14 w-full" />
					<Skeleton className="h-14 w-full" />
				</div>
			) : digest.error ? (
				<Alert variant="destructive">
					<CircleAlertIcon />
					<AlertTitle>This digest did not load</AlertTitle>
					<AlertDescription>{digest.error.message}</AlertDescription>
				</Alert>
			) : (
				<DigestLines digest={digest.data ?? null} />
			)}
		</div>
	);
}

function DigestLines({ digest }: { digest: Digest | null }) {
	const runs = digest?.runs ?? [];
	const sources = digest?.sources ?? [];
	return (
		<>
			<section className="flex flex-col gap-3">
				<h2 className="font-medium text-sm">Runs</h2>
				{runs.length > 0 ? (
					<ItemGroup className="gap-2">
						{runs.map((run) => (
							<DigestRun key={run.runId} run={run} />
						))}
					</ItemGroup>
				) : (
					<p className="text-muted-foreground text-sm">
						No run ended before this digest.
					</p>
				)}
			</section>
			{sources.length > 0 ? (
				<section className="flex flex-col gap-3">
					<h2 className="font-medium text-sm">Knowledge sources</h2>
					<ItemGroup className="gap-2">
						{sources.map((source) => (
							<DigestKnowledgeSource
								key={`${source.projectId} ${source.title}`}
								source={source}
							/>
						))}
					</ItemGroup>
				</section>
			) : null}
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
		<Item variant="outline" size="sm">
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
				<UsefulChoice run={run} />
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
		<Item variant="outline" size="sm">
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
