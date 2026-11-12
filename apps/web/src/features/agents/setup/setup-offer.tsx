import { Button } from "@nightshift/ui/components/button";
import { Spinner } from "@nightshift/ui/components/spinner";
import { DownloadIcon, LogInIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { CheckTarget, CliCheck } from "@/shared/api";
import {
	AgentSetupDialog,
	useAgentSetupActions,
	useAgentSetupStatus,
} from "./agent-setup-dialog";
import { setupOffer, setupStep } from "./setup-state";
import { InstallConfirmDialog } from "./setup-steps";

/**
 * What an agent's panel offers from the guided setup: Install for a
 * missing agent, Sign in for one that is signed out, or the setup that
 * runs. Install asks first. Each opens the setup dialog on that agent.
 */
export function AgentSetupButton({
	target,
	check,
}: {
	target: CheckTarget;
	check: CliCheck | undefined;
}) {
	const status = useAgentSetupStatus();
	const actions = useAgentSetupActions();
	const [confirming, setConfirming] = useState(false);
	const [open, setOpen] = useState(false);
	const agent = status.data?.agents.find((a) => a.harness === target);
	if (!agent || !status.data?.available) return null;
	const offer = setupOffer(agent, check);
	const harness = agent.harness;

	return (
		<>
			{offer === "install" ? (
				<Button size="sm" onClick={() => setConfirming(true)}>
					<DownloadIcon data-icon="inline-start" />
					Install
				</Button>
			) : null}
			{offer === "sign-in" ? (
				<Button
					size="sm"
					disabled={actions.signIn.isPending}
					onClick={() =>
						actions.signIn.mutate(
							{ harness },
							{
								onSuccess: () => setOpen(true),
								onError: (error) =>
									toast.error(`Sign-in did not start: ${error.message}`),
							},
						)
					}
				>
					{actions.signIn.isPending ? (
						<Spinner data-icon="inline-start" />
					) : (
						<LogInIcon data-icon="inline-start" />
					)}
					Sign in
				</Button>
			) : null}
			{offer === "running" ? (
				<Button size="sm" variant="outline" onClick={() => setOpen(true)}>
					<Spinner data-icon="inline-start" />
					{setupStep(agent).kind === "installing"
						? "Installing…"
						: "Signing in…"}
				</Button>
			) : null}
			<InstallConfirmDialog
				agent={agent}
				open={confirming}
				onOpenChange={(next) => {
					setConfirming(next);
					if (!next) actions.install.reset();
				}}
				onConfirm={() =>
					actions.install.mutate(
						{ harness },
						{
							onSuccess: () => {
								setConfirming(false);
								setOpen(true);
							},
						},
					)
				}
				pending={actions.install.isPending}
				error={actions.install.error?.message ?? null}
			/>
			<AgentSetupDialog open={open} onOpenChange={setOpen} harness={harness} />
		</>
	);
}

/**
 * Where to set up an agent when Night Shift cannot do it here: on another
 * computer, in a container, or on a system it does not support. Shows only
 * for an agent that is missing or signed out.
 */
export function AgentSetupHint({
	target,
	check,
}: {
	target: CheckTarget;
	check: CliCheck | undefined;
}) {
	const status = useAgentSetupStatus();
	const agent = status.data?.agents.find((a) => a.harness === target);
	const offer = setupOffer(agent, check);
	if (status.data?.available !== false || !status.data.message) return null;
	if (offer !== "install" && offer !== "sign-in") return null;
	return <p className="text-muted-foreground text-sm">{status.data.message}</p>;
}
