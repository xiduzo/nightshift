import { Button } from "@nightshift/ui/components/button";
import { Card, CardContent } from "@nightshift/ui/components/card";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@nightshift/ui/components/empty";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { FolderIcon } from "lucide-react";
import { projectQueries } from "@/features/projects";
import { PageHeading, PageSection, SiteHeader } from "@/shared/page";
import { UsedBy } from "./connections/secret-parts";
import { OtherDevicesSecrets } from "./other-device";
import { otherDeviceQueries, projectSecretQueries } from "./queries";

/**
 * The Secrets page of the Space: the secrets of each project, and the
 * secrets saved on your other devices. This computer's own secrets and
 * the Personal ones are on the Secrets page of this computer.
 */
export function SpaceSecretsPage() {
	const projects = useQuery(projectQueries.list());
	const otherDevices = useQuery(otherDeviceQueries.list());

	return (
		<>
			<SiteHeader crumbs={[{ label: "Secrets" }]} />
			<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
				<div className="mx-auto w-full max-w-4xl">
					<PageHeading
						title="Secrets"
						description={
							<>
								The secrets of each project, and the secrets on your other
								devices. Your Personal secrets are on the{" "}
								<Link
									to="/secrets"
									className="underline underline-offset-4 hover:text-foreground"
								>
									Secrets page of this computer
								</Link>
								.
							</>
						}
					/>
				</div>
				<div className="mx-auto flex w-full max-w-4xl flex-col gap-10">
					<PageSection
						title="Projects"
						description="Every run of a project can use its secrets, on any device."
					>
						{projects.data ? (
							<ProjectsSecrets projects={projects.data} />
						) : (
							<Skeleton className="h-32 w-full rounded-xl" />
						)}
					</PageSection>
					<OtherDevicesSecrets devices={otherDevices.data ?? []} />
				</div>
			</div>
		</>
	);
}

/** One item per project: the names of its secrets, and a link to its Secrets page. */
function ProjectsSecrets({
	projects,
}: {
	projects: readonly { id: string; name: string }[];
}) {
	const lists = useQueries({
		queries: projects.map((project) => projectSecretQueries.list(project.id)),
	});
	if (projects.length === 0) {
		return (
			<Card className="py-0">
				<CardContent className="px-0">
					<Empty>
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<FolderIcon />
							</EmptyMedia>
							<EmptyTitle>No projects yet</EmptyTitle>
							<EmptyDescription>
								Add a project. You can then give it its own secrets.
							</EmptyDescription>
						</EmptyHeader>
					</Empty>
				</CardContent>
			</Card>
		);
	}
	return (
		<ItemGroup className="gap-2" aria-label="Secrets of each project">
			{projects.map((project, index) => {
				const list = lists[index];
				const names = list?.data?.secrets.map((secret) => secret.name) ?? [];
				return (
					<Item key={project.id} variant="outline" size="sm">
						<ItemContent>
							<ItemTitle>{project.name}</ItemTitle>
							{list?.isPending ? (
								<Skeleton className="h-4 w-40" />
							) : (
								<ItemDescription className="font-mono">
									{list?.data?.available === false || list?.isError ? (
										<span className="font-sans">Not available now.</span>
									) : names.length === 0 ? (
										<span className="font-sans">No secrets yet.</span>
									) : (
										<UsedBy users={names} />
									)}
								</ItemDescription>
							)}
						</ItemContent>
						<ItemActions>
							<Button
								variant="outline"
								size="sm"
								nativeButton={false}
								render={
									<Link
										to="/projects/$projectId/secrets"
										params={{ projectId: project.id }}
									/>
								}
							>
								Open
							</Button>
						</ItemActions>
					</Item>
				);
			})}
		</ItemGroup>
	);
}
