import { Alert, AlertDescription } from "@nightshift/ui/components/alert";
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
import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import {
	CodeBlock,
	CodeBlockActions,
	CodeBlockContent,
	CodeBlockCopyButton,
} from "@nightshift/ui/components/code-block";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@nightshift/ui/components/collapsible";
import {
	DialogClose,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@nightshift/ui/components/dialog";
import {
	Field,
	FieldContent,
	FieldDescription,
	FieldError,
	FieldLabel,
	FieldTitle,
} from "@nightshift/ui/components/field";
import { Input } from "@nightshift/ui/components/input";
import { Progress, ProgressLabel } from "@nightshift/ui/components/progress";
import {
	RadioGroup,
	RadioGroupItem,
} from "@nightshift/ui/components/radio-group";
import { Spinner } from "@nightshift/ui/components/spinner";
import { useQuery } from "@tanstack/react-query";
import {
	ChevronDownIcon,
	CircleAlertIcon,
	CircleCheckIcon,
	ExternalLinkIcon,
	InfoIcon,
} from "lucide-react";
import { useId, useState } from "react";
import type { AgentSetupView, HarnessRowName } from "@/shared/api";
import { useNow } from "@/shared/format";
import { connectionQueries } from "../queries";
import {
	actionLabel,
	agentSummary,
	installProgress,
	RECOMMENDED,
	type SetupNote,
	type SetupStep,
	signInAccount,
} from "./setup-state";

/**
 * The steps of the guided setup, one component each. Each draws the header,
 * the body and the footer of the setup dialog, so a new step (a decider,
 * say) is one more component and one more case in the dialog.
 */

/** Whether the agent is signed in, from its check. Null until the check answers. */
function useSignedIn(agent: AgentSetupView): boolean | null {
	const check = useQuery({
		...connectionQueries.check(agent.harness),
		staleTime: 60_000,
		meta: { quietErrors: true },
	});
	if (!check.data) return null;
	return check.data.path !== null && check.data.signIn === "signed_in";
}

/** Choose an agent, then install it or sign in. Shows how the last try ended. */
export function ChooseAgentStep({
	agents,
	agent,
	step,
	blocked,
	onPick,
	onAct,
	acting,
	error,
}: {
	agents: readonly AgentSetupView[];
	/** The agent that is picked. */
	agent: AgentSetupView;
	step: Extract<SetupStep, { kind: "choose" }>;
	/** Why setup cannot act here, for the person. */
	blocked: string | null;
	onPick: (harness: HarnessRowName) => void;
	/** Installs the agent (after a question) or signs it in, as `step.action` says. */
	onAct: () => void;
	acting: boolean;
	error: string | null;
}) {
	const id = useId();
	const signedIn = useSignedIn(agent) ?? false;
	return (
		<>
			<DialogHeader>
				<DialogTitle>Set up an agent</DialogTitle>
				<DialogDescription>
					Choose the agent that does the work in your flows. Night Shift
					installs it, then you sign in.
				</DialogDescription>
			</DialogHeader>
			<RadioGroup
				value={agent.harness}
				onValueChange={(next) => onPick(next as HarnessRowName)}
				className="gap-2"
				aria-label="Agent"
			>
				{agents.map((choice) => (
					<FieldLabel key={choice.harness} htmlFor={`${id}-${choice.harness}`}>
						<Field orientation="horizontal">
							<FieldContent>
								<FieldTitle>
									{choice.label}
									{choice.harness === RECOMMENDED ? (
										<Badge variant="secondary">Recommended</Badge>
									) : null}
								</FieldTitle>
								<FieldDescription>{agentSummary(choice)}</FieldDescription>
							</FieldContent>
							<RadioGroupItem
								value={choice.harness}
								id={`${id}-${choice.harness}`}
							/>
						</Field>
					</FieldLabel>
				))}
			</RadioGroup>
			{blocked ? (
				<Alert>
					<InfoIcon />
					<AlertDescription>{blocked}</AlertDescription>
				</Alert>
			) : null}
			{step.note ? <SetupNoteAlert note={step.note} /> : null}
			{error ? <FieldError>{error}</FieldError> : null}
			<DialogFooter>
				<DialogClose render={<Button variant="outline" />}>Close</DialogClose>
				<Button disabled={blocked !== null || acting} onClick={onAct}>
					{acting ? <Spinner data-icon="inline-start" /> : null}
					{actionLabel(agent, step.action, signedIn)}
				</Button>
			</DialogFooter>
		</>
	);
}

/** How the last try ended: done, or the problem with what the installer printed. */
function SetupNoteAlert({ note }: { note: SetupNote }) {
	if (note.tone === "done") {
		return (
			<Alert>
				<CircleCheckIcon className="text-status-finished" />
				<AlertDescription>{note.text}</AlertDescription>
			</Alert>
		);
	}
	return (
		<div className="flex flex-col gap-2">
			<Alert variant="destructive">
				<CircleAlertIcon />
				<AlertDescription>{note.text}</AlertDescription>
			</Alert>
			{note.output ? (
				<SetupDetails
					facts={[{ label: "Installer messages", value: note.output }]}
				/>
			) : null}
		</div>
	);
}

/** A "Details" section that opens: exact technical text, each with a copy button. */
export function SetupDetails({
	facts,
}: {
	facts: readonly { label: string; value: string }[];
}) {
	return (
		<Collapsible className="flex flex-col gap-3">
			<CollapsibleTrigger
				render={
					<Button
						variant="ghost"
						size="sm"
						className="group/trigger -ml-2 w-fit text-muted-foreground"
					/>
				}
			>
				<ChevronDownIcon
					data-icon="inline-start"
					className="-rotate-90 transition-transform group-data-[panel-open]/trigger:rotate-0 motion-reduce:transition-none"
				/>
				Details
			</CollapsibleTrigger>
			<CollapsibleContent className="flex flex-col gap-3">
				{facts.map((fact) => (
					<Field key={fact.label} className="gap-1.5">
						<FieldTitle className="font-normal text-muted-foreground text-xs">
							{fact.label}
						</FieldTitle>
						<CodeBlock size="sm" className="bg-muted/40">
							<CodeBlockActions>
								<CodeBlockCopyButton value={fact.value} />
							</CodeBlockActions>
							<CodeBlockContent wrap className="max-h-48 text-xs">
								{fact.value}
							</CodeBlockContent>
						</CodeBlock>
					</Field>
				))}
			</CollapsibleContent>
		</Collapsible>
	);
}

/**
 * The question before an install: what Night Shift does, in plain words
 * first. Details holds the exact command and where it downloads from.
 */
export function InstallConfirmDialog({
	agent,
	open,
	onOpenChange,
	onConfirm,
	pending,
	error,
}: {
	agent: AgentSetupView | undefined;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onConfirm: () => void;
	pending: boolean;
	error: string | null;
}) {
	return (
		<AlertDialog open={open && agent !== undefined} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				{agent ? (
					<>
						<AlertDialogHeader>
							<AlertDialogTitle>Install {agent.label}?</AlertDialogTitle>
							<AlertDialogDescription>
								Night Shift downloads {agent.label} from {agent.vendor} and
								installs it for you. It needs no administrator password.
							</AlertDialogDescription>
						</AlertDialogHeader>
						<SetupDetails
							facts={[
								{ label: "Command", value: agent.install.command },
								{ label: "Source", value: agent.install.source },
							]}
						/>
						{error ? <FieldError>{error}</FieldError> : null}
						<AlertDialogFooter>
							<AlertDialogCancel>Cancel</AlertDialogCancel>
							<AlertDialogAction disabled={pending} onClick={onConfirm}>
								{pending ? <Spinner data-icon="inline-start" /> : null}
								Install
							</AlertDialogAction>
						</AlertDialogFooter>
					</>
				) : null}
			</AlertDialogContent>
		</AlertDialog>
	);
}

/** The install runs: a spinner and a bar that follows the time. */
export function InstallingStep({
	agent,
	since,
	onCancel,
	cancelling,
}: {
	agent: AgentSetupView;
	since: number;
	onCancel: () => void;
	cancelling: boolean;
}) {
	const now = useNow(1_000);
	return (
		<>
			<DialogHeader>
				<DialogTitle>Installing {agent.label}</DialogTitle>
				<DialogDescription>This can take a few minutes.</DialogDescription>
			</DialogHeader>
			<Progress value={installProgress(since, now)}>
				<ProgressLabel className="flex items-center gap-2 font-normal text-muted-foreground">
					<Spinner />
					Downloading and installing
				</ProgressLabel>
			</Progress>
			<DialogFooter>
				<CancelButton onCancel={onCancel} cancelling={cancelling} />
			</DialogFooter>
		</>
	);
}

/** Night Shift checks the sign-in, before or after the browser. */
export function CheckingStep({
	agent,
	onCancel,
	cancelling,
}: {
	agent: AgentSetupView;
	onCancel: () => void;
	cancelling: boolean;
}) {
	return (
		<>
			<DialogHeader>
				<DialogTitle>Sign in to {signInAccount(agent)}</DialogTitle>
			</DialogHeader>
			<p className="flex items-center gap-2 text-muted-foreground text-sm">
				<Spinner />
				Checking the sign-in
			</p>
			<DialogFooter>
				<CancelButton onCancel={onCancel} cancelling={cancelling} />
			</DialogFooter>
		</>
	);
}

/**
 * The person finishes the sign-in in the browser. The agent opens the page
 * itself, and the button opens it again. A code field shows only when the
 * agent waits for a code.
 */
export function BrowserStep({
	agent,
	url,
	codeNeeded,
	onSendCode,
	sending,
	codeError,
	onCancel,
	cancelling,
}: {
	agent: AgentSetupView;
	url: string | null;
	codeNeeded: boolean;
	/** Gives the agent the code. `sent` empties the field once the agent took it. */
	onSendCode: (code: string, sent: () => void) => void;
	sending: boolean;
	codeError: string | null;
	onCancel: () => void;
	cancelling: boolean;
}) {
	const id = useId();
	const [code, setCode] = useState("");
	const trimmed = code.trim();
	return (
		<>
			<DialogHeader>
				<DialogTitle>Sign in to {signInAccount(agent)}</DialogTitle>
				<DialogDescription>Finish in your browser.</DialogDescription>
			</DialogHeader>
			{url ? (
				<Button
					variant="outline"
					className="w-fit"
					nativeButton={false}
					render={<a href={url} target="_blank" rel="noreferrer" />}
				>
					<ExternalLinkIcon data-icon="inline-start" />
					Open the sign-in page
				</Button>
			) : (
				<Button variant="outline" className="w-fit" disabled>
					<Spinner data-icon="inline-start" />
					Open the sign-in page
				</Button>
			)}
			{codeNeeded ? (
				<form
					onSubmit={(event) => {
						event.preventDefault();
						if (trimmed) onSendCode(trimmed, () => setCode(""));
					}}
				>
					<Field data-invalid={codeError ? true : undefined}>
						<FieldLabel htmlFor={`${id}-code`}>Code</FieldLabel>
						<div className="flex gap-2">
							<Input
								id={`${id}-code`}
								value={code}
								onChange={(event) => setCode(event.target.value)}
								className="font-mono"
								autoComplete="one-time-code"
								spellCheck={false}
								aria-describedby={`${id}-code-hint`}
								aria-invalid={codeError ? true : undefined}
							/>
							<Button type="submit" disabled={!trimmed || sending}>
								{sending ? <Spinner data-icon="inline-start" /> : null}
								Send code
							</Button>
						</div>
						<FieldDescription id={`${id}-code-hint`}>
							If the page shows a code, paste it here.
						</FieldDescription>
						{codeError ? <FieldError>{codeError}</FieldError> : null}
					</Field>
				</form>
			) : null}
			<DialogFooter>
				<CancelButton onCancel={onCancel} cancelling={cancelling} />
			</DialogFooter>
		</>
	);
}

/** Stops the install, the sign-in or the download that runs. */
export function CancelButton({
	onCancel,
	cancelling,
}: {
	onCancel: () => void;
	cancelling: boolean;
}) {
	return (
		<Button variant="outline" disabled={cancelling} onClick={onCancel}>
			{cancelling ? <Spinner data-icon="inline-start" /> : null}
			Cancel
		</Button>
	);
}
