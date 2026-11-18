/** The dialog that removes a secret of this computer or a Personal one. It names what uses the secret. */
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@nightshift/ui/components/alert-dialog";
import { Spinner } from "@nightshift/ui/components/spinner";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import type { SecretView } from "@/shared/api";
import { connectionMutations } from "../queries";
import {
	flowNamesOf,
	type SecretRef,
	usersOf,
	webhookFlowsOf,
} from "./secret-columns";

export function RemoveSecretDialog({
	target,
	secret,
	onOpenChange,
}: {
	target: SecretRef | null;
	secret: SecretView | null;
	onOpenChange: (open: boolean) => void;
}) {
	const removeSecret = useMutation(
		connectionMutations.removeSecret({
			onSuccess: () => {
				toast.success(`Removed ${target?.name}`);
				onOpenChange(false);
			},
			onError: (error) => toast.error(`Not removed: ${error.message}`),
		}),
	);
	const usedBy = secret ? [...secret.usedBy, ...secret.tools] : [];
	const flows = secret ? flowNamesOf(secret) : [];
	const webhooks = secret ? webhookFlowsOf(secret) : [];
	const users = secret ? usersOf(secret) : [];
	const consequence =
		users.length === 0
			? "Nothing uses it."
			: secret?.inEnv
				? `${users.join(", ")} will use the value that is set outside Night Shift instead.`
				: [
						usedBy.length > 0
							? `${usedBy.join(", ")} will have no value for it. Agent nodes that use ${usedBy.length === 1 ? "that tool" : "those tools"} cannot run until you set it again.`
							: null,
						flows.length > 0
							? `Flows that use it (${flows.join(", ")}) stop at the step that needs it until you set it again.`
							: null,
						webhooks.length > 0
							? `Webhooks of ${webhooks.join(", ")} stop working until you set it again.`
							: null,
					]
						.filter(Boolean)
						.join(" ");

	return (
		<AlertDialog open={target !== null} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						{target?.scope === "personal" ? (
							<>
								Remove the Personal secret{" "}
								<span className="font-mono">{target.name}</span>?
							</>
						) : (
							<>
								Remove <span className="font-mono">{target?.name}</span> from
								this computer?
							</>
						)}
					</AlertDialogTitle>
					<AlertDialogDescription>{consequence}</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<AlertDialogAction
						variant="destructive"
						disabled={removeSecret.isPending}
						onClick={() => {
							if (target) removeSecret.mutate(target);
						}}
					>
						{removeSecret.isPending ? (
							<Spinner data-icon="inline-start" />
						) : null}
						{removeSecret.isPending ? "Removing…" : "Remove"}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
