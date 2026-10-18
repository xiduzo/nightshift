import type { AppRouterClient } from "@nightshift/api/routers/index";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
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
	Field,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "@nightshift/ui/components/field";
import { Input } from "@nightshift/ui/components/input";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { Spinner } from "@nightshift/ui/components/spinner";
import type { InferClientOutputs } from "@orpc/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleAlertIcon, CircleCheckIcon, RotateCwIcon } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";

type Outputs = InferClientOutputs<AppRouterClient>;
type Readiness = Outputs["projects"]["check"];
type Step = Readiness["steps"][number];
type GitInstall = Outputs["projects"]["installGit"];

const STEP_TITLE: Record<Step["id"], string> = {
	git: "Git on this computer",
	folder: "Project folder",
	commit: "First commit",
	identity: "Your name and email for git",
};

const STEP_OK: Record<Step["id"], string> = {
	git: "Git is installed.",
	folder: "The folder uses git.",
	commit: "The project has a commit.",
	identity: "Git knows your name and email.",
};

/**
 * What a folder needs before runs can start in it, with a fix button per
 * problem. A fix that changes something asks first.
 */
export function ProjectReadiness({
	readiness,
	checking,
	onRecheck,
	onUseFolder,
}: {
	readiness: Readiness;
	checking: boolean;
	onRecheck: () => void;
	onUseFolder: (path: string) => void;
}) {
	const queryClient = useQueryClient();
	const [confirm, setConfirm] = useState<"install-git" | "set-up-git" | null>(
		null,
	);
	const [install, setInstall] = useState<GitInstall | null>(null);

	const refresh = () =>
		queryClient.invalidateQueries({
			queryKey: orpc.projects.check.key({ input: { path: readiness.path } }),
		});

	const installGit = useMutation(
		orpc.projects.installGit.mutationOptions({
			onSuccess: (result) => {
				setConfirm(null);
				setInstall(result);
				if (result.kind === "started") {
					toast.info(
						"Follow the steps in the installer window. Then choose Check again.",
					);
				}
			},
		}),
	);

	// One set-up button does all of its steps: show it on the first one.
	const setUpStep = readiness.steps.find((step) => step.fix === "set-up-git");
	const visible = readiness.steps.filter((step) => step.status !== "skipped");

	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-center justify-between gap-2">
				<p className="font-medium text-sm">Before runs can start</p>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					disabled={checking}
					onClick={onRecheck}
				>
					{checking ? (
						<Spinner data-icon="inline-start" />
					) : (
						<RotateCwIcon data-icon="inline-start" />
					)}
					Check again
				</Button>
			</div>
			<ItemGroup className="gap-2">
				{visible.map((step) => (
					<Item key={step.id} variant="outline" size="sm">
						<ItemMedia variant="icon">
							{step.status === "ok" ? (
								<CircleCheckIcon className="text-primary" />
							) : (
								<CircleAlertIcon className="text-destructive" />
							)}
						</ItemMedia>
						<ItemContent className="min-w-0">
							<ItemTitle>{STEP_TITLE[step.id]}</ItemTitle>
							<ItemDescription className="break-words">
								{step.status === "ok" ? STEP_OK[step.id] : step.problem}
							</ItemDescription>
						</ItemContent>
						{step.fix === "install-git" ? (
							<ItemActions>
								<Button
									type="button"
									size="sm"
									onClick={() => setConfirm("install-git")}
								>
									Install git
								</Button>
							</ItemActions>
						) : null}
						{step.fix === "use-top-folder" && readiness.topLevel ? (
							<ItemActions>
								<Button
									type="button"
									size="sm"
									onClick={() => {
										if (readiness.topLevel) onUseFolder(readiness.topLevel);
									}}
								>
									Use top folder
								</Button>
							</ItemActions>
						) : null}
						{step === setUpStep ? (
							<ItemActions>
								<Button
									type="button"
									size="sm"
									onClick={() => setConfirm("set-up-git")}
								>
									Set up git
								</Button>
							</ItemActions>
						) : null}
					</Item>
				))}
			</ItemGroup>

			{install?.kind === "command" ? (
				<Alert>
					<AlertTitle>Install git from a terminal</AlertTitle>
					<AlertDescription>
						Run this command, then choose Check again.
						<code className="mt-1 block rounded bg-muted px-2 py-1 font-mono text-foreground">
							{install.command}
						</code>
					</AlertDescription>
				</Alert>
			) : null}
			{install?.kind === "manual" ? (
				<Alert>
					<AlertTitle>Download git</AlertTitle>
					<AlertDescription>
						<span>
							Install git from{" "}
							<a
								className="underline underline-offset-4"
								href={install.url}
								target="_blank"
								rel="noreferrer"
							>
								the git website
							</a>
							, then choose Check again.
						</span>
					</AlertDescription>
				</Alert>
			) : null}

			<AlertDialog
				open={confirm === "install-git"}
				onOpenChange={(open) => {
					if (!open) setConfirm(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Install git?</AlertDialogTitle>
						<AlertDialogDescription>
							Night Shift opens the git installer of this computer. You confirm
							each step there.
						</AlertDialogDescription>
					</AlertDialogHeader>
					{installGit.error ? (
						<FieldError>{installGit.error.message}</FieldError>
					) : null}
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							disabled={installGit.isPending}
							onClick={() => installGit.mutate({})}
						>
							{installGit.isPending ? (
								<Spinner data-icon="inline-start" />
							) : null}
							Install git
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			<SetUpGitDialog
				open={confirm === "set-up-git"}
				onOpenChange={(open) => {
					if (!open) setConfirm(null);
				}}
				path={readiness.path}
				needsIdentity={readiness.needsIdentity}
				onDone={() => {
					setConfirm(null);
					void refresh();
				}}
			/>
		</div>
	);
}

function SetUpGitDialog({
	open,
	onOpenChange,
	path,
	needsIdentity,
	onDone,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	path: string;
	needsIdentity: boolean;
	onDone: () => void;
}) {
	const id = useId();
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const setUpGit = useMutation(
		orpc.projects.setUpGit.mutationOptions({
			onSuccess: () => {
				toast.success("Git is set up in this folder");
				onDone();
			},
		}),
	);
	const missingIdentity = needsIdentity && (!name.trim() || !email.trim());

	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<form
					className="contents"
					onSubmit={(event) => {
						event.preventDefault();
						if (missingIdentity) return;
						setUpGit.mutate({
							path,
							...(needsIdentity
								? { name: name.trim(), email: email.trim() }
								: {}),
						});
					}}
				>
					<AlertDialogHeader>
						<AlertDialogTitle>Set up git in this folder?</AlertDialogTitle>
						<AlertDialogDescription>
							Night Shift turns on git here and saves every file in a first
							commit. Files that git ignores stay out.
						</AlertDialogDescription>
					</AlertDialogHeader>
					{needsIdentity ? (
						<FieldGroup className="gap-4">
							<Field>
								<FieldLabel htmlFor={`${id}-name`}>Your name</FieldLabel>
								<Input
									id={`${id}-name`}
									value={name}
									onChange={(event) => setName(event.target.value)}
									placeholder="Ada Lovelace"
									autoComplete="name"
								/>
							</Field>
							<Field>
								<FieldLabel htmlFor={`${id}-email`}>Your email</FieldLabel>
								<Input
									id={`${id}-email`}
									type="email"
									value={email}
									onChange={(event) => setEmail(event.target.value)}
									placeholder="ada@example.com"
									autoComplete="email"
								/>
							</Field>
						</FieldGroup>
					) : null}
					{setUpGit.error ? (
						<FieldError>{setUpGit.error.message}</FieldError>
					) : null}
					<AlertDialogFooter>
						<AlertDialogCancel type="button">Cancel</AlertDialogCancel>
						<AlertDialogAction
							type="submit"
							disabled={setUpGit.isPending || missingIdentity}
						>
							{setUpGit.isPending ? <Spinner data-icon="inline-start" /> : null}
							Set up git
						</AlertDialogAction>
					</AlertDialogFooter>
				</form>
			</AlertDialogContent>
		</AlertDialog>
	);
}
