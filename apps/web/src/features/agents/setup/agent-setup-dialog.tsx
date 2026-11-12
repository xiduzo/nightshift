import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@nightshift/ui/components/dialog";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { CircleAlertIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type {
	AgentSetupJob,
	AgentSetupStatus,
	AgentSetupView,
	HarnessRowName,
} from "@/shared/api";
import { itemOf } from "../agents-selection";
import {
	agentSetupMutations,
	agentSetupQueries,
	connectionQueries,
	harnessQueries,
	profileQueries,
	programQueries,
} from "../queries";
import { justReady, pickAgent, setupRuns, setupStep } from "./setup-state";
import {
	BrowserStep,
	CheckingStep,
	ChooseAgentStep,
	InstallConfirmDialog,
	InstallingStep,
} from "./setup-steps";

/**
 * The guided setup of an agent on this computer (ADR 25): choose Claude
 * Code or Codex, install it after a question, sign in in the browser.
 * Night Shift then adds the agent with a profile, and the profile opens.
 */

/** What the setup can do here, and each agent's job. Quiet when it fails: what needs it hides. */
export function useAgentSetupStatus() {
	return useQuery({
		...agentSetupQueries.status(),
		meta: { quietErrors: true },
	});
}

/**
 * The actions of the setup. Each puts the job it started in the status,
 * so the status asks again until the job ends.
 */
export function useAgentSetupActions() {
	const queryClient = useQueryClient();
	const put = (view: AgentSetupView) =>
		queryClient.setQueryData(
			agentSetupQueries.status().queryKey,
			(old: AgentSetupStatus | undefined) =>
				old && {
					...old,
					agents: old.agents.map((agent) =>
						agent.harness === view.harness ? view : agent,
					),
				},
		);
	return {
		install: useMutation(agentSetupMutations.install({ onSuccess: put })),
		signIn: useMutation(agentSetupMutations.signIn({ onSuccess: put })),
		sendCode: useMutation(agentSetupMutations.sendCode({ onSuccess: put })),
		cancel: useMutation(
			agentSetupMutations.cancel({
				onSuccess: put,
				onError: (error) => toast.error(`Not stopped: ${error.message}`),
			}),
		),
	};
}

/**
 * Follows the setup jobs. When one ends, the checks and the lists read
 * again. When one makes an agent ready, a toast says so and its profile
 * opens. Mount it once per page: the dialog does.
 */
function useSetupEnd(
	status: AgentSetupStatus | undefined,
	onReady: () => void,
) {
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const seen = useRef(new Map<HarnessRowName, AgentSetupJob>());
	useEffect(() => {
		for (const agent of status?.agents ?? []) {
			const before = seen.current.get(agent.harness);
			seen.current.set(agent.harness, agent.job);
			if (!before || !setupRuns(before) || setupRuns(agent.job)) continue;
			for (const queryKey of [
				connectionQueries.checks(),
				harnessQueries.all(),
				profileQueries.all(),
				programQueries.all(),
			]) {
				void queryClient.invalidateQueries({ queryKey });
			}
			const ready = justReady(before, agent.job);
			if (!ready) continue;
			toast.success(`${agent.label} is ready`, {
				description: `The profile ${ready.profileName} uses it.`,
			});
			onReady();
			void navigate({
				to: "/agents",
				search: { item: itemOf({ kind: "profile", id: ready.profileId }) },
			});
		}
	}, [status, queryClient, navigate, onReady]);
}

/**
 * The setup dialog. `harness` picks the agent it opens on. It follows a
 * job that runs, also while it is closed, and closes when the agent is
 * ready.
 */
export function AgentSetupDialog({
	open,
	onOpenChange,
	harness,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	harness?: HarnessRowName;
}) {
	const status = useAgentSetupStatus();
	useSetupEnd(status.data, () => onOpenChange(false));
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				{open ? (
					<SetupBody
						status={status.data}
						loading={status.isPending}
						error={status.error?.message ?? null}
						wanted={harness}
					/>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

/** The step of the picked agent: the choice, the install, or the sign-in. */
function SetupBody({
	status,
	loading,
	error,
	wanted,
}: {
	status: AgentSetupStatus | undefined;
	loading: boolean;
	error: string | null;
	wanted: HarnessRowName | undefined;
}) {
	const [picked, setPicked] = useState(wanted);
	const [confirming, setConfirming] = useState(false);
	const actions = useAgentSetupActions();

	if (loading) {
		return (
			<div className="flex flex-col gap-3" aria-hidden>
				<Skeleton className="h-6 w-48" />
				<Skeleton className="h-16 w-full" />
				<Skeleton className="h-16 w-full" />
			</div>
		);
	}
	const agent = status ? pickAgent(status.agents, picked) : undefined;
	if (!status || !agent) {
		return (
			<>
				<DialogHeader>
					<DialogTitle>Set up an agent</DialogTitle>
				</DialogHeader>
				<Alert variant="destructive">
					<CircleAlertIcon />
					<AlertTitle>The setup did not load</AlertTitle>
					{error ? <AlertDescription>{error}</AlertDescription> : null}
				</Alert>
			</>
		);
	}

	const harness = agent.harness;
	const step = setupStep(agent);
	const cancel = () => actions.cancel.mutate({ harness });
	const cancelling = actions.cancel.isPending;

	switch (step.kind) {
		case "choose":
			return (
				<>
					<ChooseAgentStep
						agents={status.agents}
						agent={agent}
						step={step}
						blocked={status.available ? null : status.message}
						onPick={(next) => {
							setPicked(next);
							actions.signIn.reset();
						}}
						onAct={() => {
							if (step.action === "install") setConfirming(true);
							else actions.signIn.mutate({ harness });
						}}
						acting={actions.signIn.isPending}
						error={actions.signIn.error?.message ?? null}
					/>
					<InstallConfirmDialog
						agent={agent}
						open={confirming}
						onOpenChange={(open) => {
							setConfirming(open);
							if (!open) actions.install.reset();
						}}
						onConfirm={() =>
							actions.install.mutate(
								{ harness },
								{ onSuccess: () => setConfirming(false) },
							)
						}
						pending={actions.install.isPending}
						error={actions.install.error?.message ?? null}
					/>
				</>
			);
		case "installing":
			return (
				<InstallingStep
					agent={agent}
					since={step.since}
					onCancel={cancel}
					cancelling={cancelling}
				/>
			);
		case "checking":
			return (
				<CheckingStep agent={agent} onCancel={cancel} cancelling={cancelling} />
			);
		case "browser":
			return (
				<BrowserStep
					agent={agent}
					url={step.url}
					codeNeeded={step.codeNeeded}
					onSendCode={(code, sent) =>
						actions.sendCode.mutate({ harness, code }, { onSuccess: sent })
					}
					sending={actions.sendCode.isPending}
					codeError={actions.sendCode.error?.message ?? null}
					onCancel={cancel}
					cancelling={cancelling}
				/>
			);
	}
}
