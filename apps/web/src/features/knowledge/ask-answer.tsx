import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { Button } from "@nightshift/ui/components/button";
import {
	Card,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@nightshift/ui/components/card";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { Spinner } from "@nightshift/ui/components/spinner";
import { CircleAlertIcon, SearchXIcon } from "lucide-react";
import { OVERVIEW_ROWS } from "@/features/dashboard";
import type { KnowledgeHit } from "@/shared/api";
import { SearchHits } from "./knowledge-search";

/**
 * What Ask found: the files an agent who asks this reads first, or, when it
 * finds nothing, a way to fill the gap: write the answer, or let an agent
 * look for it.
 */
export function AskAnswer({
	query,
	hits,
	error,
	onOpen,
	onTell,
	onFind,
	finding,
}: {
	query: string;
	/** Undefined while the search runs. */
	hits: readonly KnowledgeHit[] | undefined;
	error: Error | null;
	onOpen: (path: string) => void;
	/** Unset: the person may not tell. */
	onTell: (() => void) | undefined;
	/** Unset: the person may not let an agent look. */
	onFind: (() => void) | undefined;
	finding: boolean;
}) {
	if (error) {
		return (
			<Alert variant="destructive">
				<CircleAlertIcon />
				<AlertTitle>The search did not work</AlertTitle>
				<AlertDescription>{error.message}</AlertDescription>
			</Alert>
		);
	}
	if (!hits) return <Skeleton className="h-24 w-full" />;
	if (hits.length === 0) {
		return (
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<SearchXIcon aria-hidden="true" className="size-4" />
						Agents find nothing for “{query}”
					</CardTitle>
					<CardDescription>
						{onTell || onFind
							? "Write the answer, or let an agent look for it."
							: "Nobody wrote this down yet."}
					</CardDescription>
				</CardHeader>
				{onTell || onFind ? (
					<CardFooter className="gap-2">
						{onTell ? <Button onClick={onTell}>Write the answer</Button> : null}
						{onFind ? (
							<Button variant="outline" disabled={finding} onClick={onFind}>
								{finding ? <Spinner data-icon="inline-start" /> : null}
								Find it for me
							</Button>
						) : null}
					</CardFooter>
				) : null}
			</Card>
		);
	}
	return (
		<div className="flex flex-col gap-3">
			<p className="text-sm text-muted-foreground">
				An agent who asks this reads these files first.
			</p>
			<SearchHits hits={hits.slice(0, OVERVIEW_ROWS)} onOpen={onOpen} />
			{onTell ? (
				<p className="text-sm text-muted-foreground">
					Wrong or missing?{" "}
					<Button
						variant="link"
						size="sm"
						className="h-auto p-0"
						onClick={onTell}
					>
						Tell the right answer
					</Button>
				</p>
			) : null}
		</div>
	);
}
