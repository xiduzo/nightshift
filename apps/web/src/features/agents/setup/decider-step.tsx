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
import { Button } from "@nightshift/ui/components/button";
import {
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
import {
	CircleAlertIcon,
	CircleCheckIcon,
	ExternalLinkIcon,
	InfoIcon,
} from "lucide-react";
import { useId, useState } from "react";
import type { DeciderSetupStatus } from "@/shared/api";
import { useNow } from "@/shared/format";
import {
	aboutSize,
	choiceOf,
	type DeciderChoice,
	type DeciderNote,
	deciderStep,
	downloadLine,
	localAction,
	localSummary,
} from "./decider-state";
import { installProgress } from "./setup-state";
import { CancelButton, SetupDetails } from "./setup-steps";

/**
 * The step after an agent is ready: choose the decider that makes the small
 * choices in flows (Q22). Local runs Ollama on this computer, with no
 * account. TypeSafe Jev takes a key. Skip keeps what new nodes use now.
 * Like the steps in `setup-steps.tsx`, it draws the header, the body and
 * the footer of the setup dialog.
 */

/** What the step asks of the server. Each answers with the new status. */
export type DeciderActions = {
	installOllama: () => void;
	useLocal: () => void;
	useTypesafe: (key: string | null) => void;
	cancel: () => void;
	/** Asks the server again: after the person installed Ollama themselves. */
	checkAgain: () => void;
	/** An action waits for its answer. */
	pending: boolean;
	checking: boolean;
	cancelling: boolean;
	/** Why the last action was refused. */
	error: string | null;
};

export function DeciderStep({
	status,
	actions,
	onSkip,
}: {
	status: DeciderSetupStatus;
	actions: DeciderActions;
	/** Closes the setup: new nodes keep the decider they use now. */
	onSkip: () => void;
}) {
	const step = deciderStep(status.job);
	switch (step.kind) {
		case "choose":
			return (
				<ChooseDecider
					status={status}
					note={step.note}
					actions={actions}
					onSkip={onSkip}
				/>
			);
		case "installing":
			return (
				<InstallingOllama
					since={step.since}
					onCancel={actions.cancel}
					cancelling={actions.cancelling}
				/>
			);
		case "starting":
			return (
				<>
					<DialogHeader>
						<DialogTitle>Starting Ollama</DialogTitle>
					</DialogHeader>
					<p className="flex items-center gap-2 text-muted-foreground text-sm">
						<Spinner />
						Waiting for Ollama to answer
					</p>
					<DialogFooter>
						<CancelButton
							onCancel={actions.cancel}
							cancelling={actions.cancelling}
						/>
					</DialogFooter>
				</>
			);
		case "downloading":
			return (
				<>
					<DialogHeader>
						<DialogTitle>Downloading {status.local.model}</DialogTitle>
						<DialogDescription>
							The download continues when you close this.
						</DialogDescription>
					</DialogHeader>
					<Progress value={step.percent}>
						<ProgressLabel className="flex items-center gap-2 font-normal text-muted-foreground">
							<Spinner />
							{downloadLine(step.percent, status.local.bytes)}
						</ProgressLabel>
					</Progress>
					<DialogFooter>
						<CancelButton
							onCancel={actions.cancel}
							cancelling={actions.cancelling}
						/>
					</DialogFooter>
				</>
			);
	}
}

/** Local or TypeSafe Jev, with what each needs before it can start. */
function ChooseDecider({
	status,
	note,
	actions,
	onSkip,
}: {
	status: DeciderSetupStatus;
	note: DeciderNote | null;
	actions: DeciderActions;
	onSkip: () => void;
}) {
	const id = useId();
	const [choice, setChoice] = useState<DeciderChoice>(choiceOf(status));
	const [key, setKey] = useState("");
	const [confirming, setConfirming] = useState(false);
	const blocked = status.available ? null : status.message;
	const local = localAction(status);
	const trimmed = key.trim();
	const busy = actions.pending || blocked !== null;

	const main =
		choice === "typesafe" ? (
			<Button
				disabled={busy || (trimmed === "" && !status.typesafe.keySaved)}
				onClick={() => actions.useTypesafe(trimmed === "" ? null : trimmed)}
			>
				{actions.pending ? <Spinner data-icon="inline-start" /> : null}
				Use TypeSafe Jev
			</Button>
		) : local.kind === "install" ? (
			<Button disabled={busy} onClick={() => setConfirming(true)}>
				Install Ollama
			</Button>
		) : local.kind === "download" ? (
			<Button
				disabled={blocked !== null || actions.checking}
				onClick={actions.checkAgain}
			>
				{actions.checking ? <Spinner data-icon="inline-start" /> : null}
				Check again
			</Button>
		) : (
			<Button disabled={busy} onClick={actions.useLocal}>
				{actions.pending ? <Spinner data-icon="inline-start" /> : null}
				Use this model
			</Button>
		);

	return (
		<>
			<DialogHeader>
				<DialogTitle>Choose a model that decides</DialogTitle>
				<DialogDescription>
					A flow can let a model pick the next step. The same model writes what
					a Gate asks you. You can change it in Settings.
				</DialogDescription>
			</DialogHeader>
			<RadioGroup
				value={choice}
				onValueChange={(next) => setChoice(next as DeciderChoice)}
				className="gap-2"
				aria-label="Model that decides"
			>
				<FieldLabel htmlFor={`${id}-local`}>
					<Field orientation="horizontal">
						<FieldContent>
							<FieldTitle>A model on this computer</FieldTitle>
							<FieldDescription>{localSummary(status)}</FieldDescription>
						</FieldContent>
						<RadioGroupItem value="local" id={`${id}-local`} />
					</Field>
				</FieldLabel>
				<FieldLabel htmlFor={`${id}-typesafe`}>
					<Field orientation="horizontal">
						<FieldContent>
							<FieldTitle>TypeSafe Jev, with a key</FieldTitle>
							<FieldDescription>
								Fastest. Needs a key from TypeSafe.
							</FieldDescription>
						</FieldContent>
						<RadioGroupItem value="typesafe" id={`${id}-typesafe`} />
					</Field>
				</FieldLabel>
			</RadioGroup>

			{choice === "local" && local.kind === "download" ? (
				<Alert>
					<InfoIcon />
					<AlertDescription>
						Ollama is not on this computer. Download it, install it, then choose
						Check again.
					</AlertDescription>
					<Button
						variant="outline"
						size="sm"
						className="mt-2 w-fit"
						nativeButton={false}
						render={<a href={local.url} target="_blank" rel="noreferrer" />}
					>
						<ExternalLinkIcon data-icon="inline-start" />
						Download Ollama
					</Button>
				</Alert>
			) : null}
			{choice === "local" && status.local.where ? (
				<Alert>
					<InfoIcon />
					<AlertDescription>
						Night Shift uses Ollama at {status.local.where}. The model goes
						there.
					</AlertDescription>
				</Alert>
			) : null}

			{choice === "typesafe" ? (
				<Field>
					<FieldLabel htmlFor={`${id}-key`}>TypeSafe key</FieldLabel>
					<Input
						id={`${id}-key`}
						type="password"
						value={key}
						onChange={(event) => setKey(event.target.value)}
						autoComplete="off"
						spellCheck={false}
						placeholder={status.typesafe.keySaved ? "Saved" : undefined}
						aria-describedby={`${id}-key-hint`}
					/>
					<FieldDescription id={`${id}-key-hint`}>
						{status.typesafe.keySaved ? (
							"A key is saved. Paste a new one to replace it."
						) : (
							<>
								Get a key at{" "}
								<a
									href={status.typesafe.keyPage}
									target="_blank"
									rel="noreferrer"
								>
									typesafe.ai
								</a>
								. Night Shift keeps it on this computer.
							</>
						)}
					</FieldDescription>
				</Field>
			) : null}

			{blocked ? (
				<Alert>
					<InfoIcon />
					<AlertDescription>{blocked}</AlertDescription>
				</Alert>
			) : null}
			{note ? <DeciderNoteAlert note={note} /> : null}
			{actions.error ? <FieldError>{actions.error}</FieldError> : null}

			<DialogFooter>
				<Button variant="outline" onClick={onSkip}>
					Choose later
				</Button>
				{main}
			</DialogFooter>

			{local.kind === "install" ? (
				<AlertDialog open={confirming} onOpenChange={setConfirming}>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>Install Ollama?</AlertDialogTitle>
							<AlertDialogDescription>
								Night Shift installs Ollama with Homebrew. Then it downloads a
								model of {aboutSize(status.local.bytes)}.
							</AlertDialogDescription>
						</AlertDialogHeader>
						<SetupDetails
							facts={[{ label: "Command", value: local.command }]}
						/>
						<AlertDialogFooter>
							<AlertDialogCancel>Cancel</AlertDialogCancel>
							<AlertDialogAction
								disabled={actions.pending}
								onClick={() => {
									setConfirming(false);
									actions.installOllama();
								}}
							>
								Install
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			) : null}
		</>
	);
}

/** How the last try ended: done, or the problem with what Homebrew printed. */
function DeciderNoteAlert({ note }: { note: DeciderNote }) {
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
					facts={[{ label: "Homebrew messages", value: note.output }]}
				/>
			) : null}
		</div>
	);
}

/** Homebrew installs Ollama: a spinner and a bar that follows the time. */
function InstallingOllama({
	since,
	onCancel,
	cancelling,
}: {
	since: number;
	onCancel: () => void;
	cancelling: boolean;
}) {
	const now = useNow(1_000);
	return (
		<>
			<DialogHeader>
				<DialogTitle>Installing Ollama</DialogTitle>
				<DialogDescription>This can take a few minutes.</DialogDescription>
			</DialogHeader>
			<Progress value={installProgress(since, now)}>
				<ProgressLabel className="flex items-center gap-2 font-normal text-muted-foreground">
					<Spinner />
					Installing with Homebrew
				</ProgressLabel>
			</Progress>
			<DialogFooter>
				<CancelButton onCancel={onCancel} cancelling={cancelling} />
			</DialogFooter>
		</>
	);
}
