import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { Button } from "@nightshift/ui/components/button";
import { Card, CardContent } from "@nightshift/ui/components/card";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@nightshift/ui/components/empty";
import { useMutation } from "@tanstack/react-query";
import { CircleAlertIcon, KeyRoundIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { SecretView } from "@/shared/api";
import { DataTable } from "@/shared/data-table";
import { toastFailure } from "@/shared/failure";
import { useNow } from "@/shared/format";
import { PageSection } from "@/shared/page";
import { connectionMutations, spaceSecretMutations } from "../queries";
import { MoveToProjectDialog } from "./move-to-project-dialog";
import { RemoveSecretDialog } from "./remove-secret-dialog";
import { rowId, type SecretRef, secretColumns } from "./secret-columns";
import { SecretDialog } from "./secret-dialog";
import { SCOPE } from "./secret-parts";

/**
 * The `${NAME}` values connections and Command nodes read: Personal ones,
 * for the person's steps on all their computers, and this computer's own.
 */
export function SecretsCard({
	secrets,
	personal,
}: {
	secrets: SecretView[];
	/** Whether the Personal secrets could be read now. */
	personal: "available" | "unavailable";
}) {
	/** The secret being set; `{ name: "" }` adds a new one. */
	const [setting, setSetting] = useState<SecretRef | null>(null);
	const [removing, setRemoving] = useState<SecretRef | null>(null);
	const [toProject, setToProject] = useState<SecretRef | null>(null);
	const now = useNow(60_000);
	const moveSecret = useMutation(
		connectionMutations.moveSecret({
			onSuccess: (_, { name, to }) => {
				toast.success(`Moved ${name} to ${SCOPE[to].label}`);
			},
			onError: toastFailure("Not moved"),
		}),
	);
	const moveToSpace = useMutation(
		spaceSecretMutations.moveIn({
			onSuccess: (_, { name }) => {
				toast.success(`Moved ${name} to this Space`);
			},
			onError: toastFailure("Not moved"),
		}),
	);
	const find = (ref: SecretRef | null) =>
		ref === null
			? null
			: (secrets.find((s) => rowId(s) === rowId(ref)) ?? null);

	return (
		<PageSection
			title="Your secrets"
			description={
				<>
					Tokens and passwords your tools and commands use, written as{" "}
					<span className="font-mono">${"{NAME}"}</span>. Night Shift keeps them
					safe and never shows them again.
				</>
			}
			actions={
				<Button
					variant="outline"
					size="sm"
					onClick={() => setSetting({ name: "", scope: "computer" })}
				>
					<PlusIcon data-icon="inline-start" />
					Add secret
				</Button>
			}
		>
			{personal === "unavailable" ? (
				<Alert>
					<CircleAlertIcon />
					<AlertTitle>Your Personal secrets are not shown</AlertTitle>
					<AlertDescription>
						Night Shift could not read them now. Check that this computer is
						online, then try again.
					</AlertDescription>
				</Alert>
			) : null}
			<Card className="py-0">
				<CardContent className="px-0">
					{secrets.length === 0 ? (
						<Empty>
							<EmptyHeader>
								<EmptyMedia variant="icon">
									<KeyRoundIcon />
								</EmptyMedia>
								<EmptyTitle>No secrets yet</EmptyTitle>
								<EmptyDescription>
									Add a secret, or write{" "}
									<span className="font-mono">${"{NAME}"}</span> in the settings
									of a tool. It then shows here.
								</EmptyDescription>
							</EmptyHeader>
						</Empty>
					) : (
						<DataTable
							aria-label="Secrets"
							columns={secretColumns({
								now,
								personal: personal === "available",
								onSet: setSetting,
								onMove: (ref) =>
									moveSecret.mutate({
										name: ref.name,
										to: ref.scope === "computer" ? "personal" : "computer",
									}),
								onMoveToProject: setToProject,
								onMoveToSpace: (ref) =>
									moveToSpace.mutate({ name: ref.name, from: ref.scope }),
								onRemove: setRemoving,
							})}
							data={secrets}
							getRowId={rowId}
						/>
					)}
				</CardContent>

				<SecretDialog
					target={setting}
					secret={find(setting)}
					personal={personal === "available"}
					onOpenChange={(open) => {
						if (!open) setSetting(null);
					}}
				/>
				<RemoveSecretDialog
					target={removing}
					secret={find(removing)}
					onOpenChange={(open) => {
						if (!open) setRemoving(null);
					}}
				/>
				<MoveToProjectDialog
					target={
						toProject === null
							? null
							: { name: toProject.name, from: { scope: toProject.scope } }
					}
					onOpenChange={(open) => {
						if (!open) setToProject(null);
					}}
				/>
			</Card>
		</PageSection>
	);
}
