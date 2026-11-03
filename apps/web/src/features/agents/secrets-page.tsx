import {
	Alert,
	AlertAction,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { Button } from "@nightshift/ui/components/button";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { CircleAlertIcon } from "lucide-react";
import { PageHeading, SiteHeader } from "@/shared/page";
import { SecretsCard } from "./connections/secrets-card";
import { connectionQueries } from "./queries";

/**
 * The Secrets page of this computer: the `${NAME}` values tools and
 * Command nodes read here, the Personal ones and this computer's. A name
 * that a project's own secret covers for every flow that uses it is not
 * listed. The Space's Secrets page has the projects and your other devices.
 */
export function SecretsPage() {
	const tools = useQuery(connectionQueries.list());

	return (
		<>
			<SiteHeader crumbs={[{ label: "Secrets" }]} />
			<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
				<div className="mx-auto w-full max-w-4xl">
					<PageHeading
						title="Secrets"
						description="Save the tokens and passwords your tools and Command nodes use. Make one Personal for all your computers, or keep it on this computer."
					/>
				</div>
				<div className="mx-auto flex w-full max-w-4xl flex-col gap-10">
					{tools.data ? (
						<SecretsCard
							secrets={tools.data.secrets}
							personal={tools.data.personal}
						/>
					) : tools.error ? (
						<Alert variant="destructive">
							<CircleAlertIcon />
							<AlertTitle>The secrets did not load</AlertTitle>
							<AlertDescription>{tools.error.message}</AlertDescription>
							<AlertAction>
								<Button
									variant="outline"
									size="sm"
									onClick={() => void tools.refetch()}
								>
									Try again
								</Button>
							</AlertAction>
						</Alert>
					) : (
						<Skeleton className="h-64 w-full rounded-xl" />
					)}
				</div>
			</div>
		</>
	);
}
