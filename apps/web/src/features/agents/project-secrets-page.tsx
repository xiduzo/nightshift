import { ProjectPage } from "@/features/projects";
import { PageHeading } from "@/shared/page";
import { projectSecretActions, projectSecretQueries } from "./queries";
import { SharedSecrets } from "./shared-secrets";

/**
 * A project's Secrets page (ADR 13): the tokens and passwords that every
 * step of the project's runs can use, on any computer. Members see the
 * names, who set each and when. A Member whose role saves flows adds,
 * changes, moves and removes them. Nobody sees a value again.
 */
export function ProjectSecretsPage({ projectId }: { projectId: string }) {
	return (
		<ProjectPage projectId={projectId} section="Secrets">
			{(project) => (
				<div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
					<PageHeading
						title="Secrets"
						description={
							<>
								Tokens and passwords this project's flows use, written as{" "}
								<span className="font-mono">${"{NAME}"}</span>. Each step of its
								runs can use them, on any computer.
							</>
						}
					/>
					<SharedSecrets
						query={projectSecretQueries.list(project.id)}
						listKey={projectSecretQueries.lists()}
						actions={projectSecretActions(project.id)}
						words={{
							title: "Project secrets",
							owner: project.name,
							trust:
								"Everyone who can change this project's flows can use it. The Host admin can read it.",
							notShown: "The secrets of this project are not shown",
							emptyTitle: "No project secrets yet",
							emptyCanChange:
								"Add one, or move one here from the Secrets page. Then every step of this project can use it.",
							emptyCannotChange:
								"When a Member adds one, every step of this project can use it.",
							nothingUses: "Nothing in this project uses it.",
						}}
					/>
				</div>
			)}
		</ProjectPage>
	);
}
