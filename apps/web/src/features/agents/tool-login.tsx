import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { Button } from "@nightshift/ui/components/button";
import {
	Field,
	FieldContent,
	FieldDescription,
	FieldGroup,
	FieldLabel,
	FieldLegend,
	FieldSet,
} from "@nightshift/ui/components/field";
import { Input } from "@nightshift/ui/components/input";
import { Spinner } from "@nightshift/ui/components/spinner";
import { Switch } from "@nightshift/ui/components/switch";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleAlertIcon, KeyRoundIcon, WandSparklesIcon } from "lucide-react";
import { useId } from "react";
import { toast } from "sonner";
import type { CliTool } from "@/shared/api";
import { CodeView } from "@/shared/code";
import { formatDateTime, formatRelative, useNow } from "@/shared/format";
import { KeyValueRows } from "./connections/key-value-rows";
import { FactList } from "./connections/parts";
import { DetailSection } from "./detail-shell";
import { cliToolMutations, cliToolQueries, connectionQueries } from "./queries";
import { type LoginDraft, loginPreset } from "./tool-login-draft";

/**
 * A CLI tool's login: how its program signs in. Several tools can run one
 * program as several accounts (`gh` and `gh-work`), each with its own
 * variables, and its own folder for a program that keeps its sign-in in a
 * file (acli).
 */

/** The login and git fields of the tool dialog. */
export function LoginFields({
	draft,
	onChange,
	program,
	name,
}: {
	draft: LoginDraft;
	onChange: (draft: LoginDraft) => void;
	/** The program the tool runs, for its usual login. */
	program: string;
	/** The tool's name, for the names of the secrets in the usual login. */
	name: string;
}) {
	const id = useId();
	const set = (patch: Partial<LoginDraft>) => onChange({ ...draft, ...patch });
	const preset = program && name ? loginPreset(program, name) : null;

	return (
		<>
			<FieldSet className="gap-3">
				<FieldLegend variant="label">Login</FieldLegend>
				<FieldDescription>
					How the program signs in. Without a login, it uses the sign-in of this
					computer. A value can read a secret, for example{" "}
					<span className="font-mono">${"{GH_WORK_TOKEN}"}</span>.
				</FieldDescription>
				{preset ? (
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="self-start"
						onClick={() => set(preset)}
					>
						<WandSparklesIcon data-icon="inline-start" />
						Fill in the usual login for {program}
					</Button>
				) : null}
				<KeyValueRows
					rows={draft.env}
					onChange={(env) => set({ env })}
					keyLabel="Variable"
					keyPlaceholder="GH_TOKEN"
					valuePlaceholder="${GH_WORK_TOKEN}"
					addLabel="Add variable"
				/>
				<Field orientation="horizontal">
					<FieldContent>
						<FieldLabel htmlFor={`${id}-own`}>Keep its own sign-in</FieldLabel>
						<FieldDescription>
							For a program that keeps its sign-in in a file, such as acli.
							Night Shift keeps a folder for this tool.
						</FieldDescription>
					</FieldContent>
					<Switch
						id={`${id}-own`}
						checked={draft.ownFolder}
						onCheckedChange={(ownFolder) => set({ ownFolder })}
					/>
				</Field>
				{draft.ownFolder ? (
					<FieldGroup className="gap-4 border-l pl-4">
						<Field>
							<FieldLabel htmlFor={`${id}-folder`}>Folder variable</FieldLabel>
							<Input
								id={`${id}-folder`}
								value={draft.folder}
								onChange={(event) => set({ folder: event.target.value })}
								className="font-mono"
								autoComplete="off"
								spellCheck={false}
							/>
							<FieldDescription>
								The program finds its folder through this variable. Example:
								HOME for acli, GH_CONFIG_DIR for gh.
							</FieldDescription>
						</Field>
						<Field>
							<FieldLabel htmlFor={`${id}-sign-in`}>
								Sign-in command{" "}
								<span className="font-normal text-muted-foreground">
									(optional)
								</span>
							</FieldLabel>
							<Input
								id={`${id}-sign-in`}
								value={draft.signInCommand}
								onChange={(event) => set({ signInCommand: event.target.value })}
								className="font-mono"
								autoComplete="off"
								spellCheck={false}
							/>
							<FieldDescription>
								Night Shift runs it before the first step, and again when a
								secret it reads changes. Example:{" "}
								<span className="font-mono">
									acli jira auth login --site your-site.atlassian.net --email
									you@example.com --token
								</span>
							</FieldDescription>
						</Field>
						{draft.signInCommand.trim() ? (
							<Field>
								<FieldLabel htmlFor={`${id}-input`}>
									Input{" "}
									<span className="font-normal text-muted-foreground">
										(optional)
									</span>
								</FieldLabel>
								<Input
									id={`${id}-input`}
									value={draft.signInInput}
									onChange={(event) => set({ signInInput: event.target.value })}
									className="font-mono"
									autoComplete="off"
									spellCheck={false}
								/>
								<FieldDescription>
									The command reads this as its input. Give a token here, not in
									the command. Example:{" "}
									<span className="font-mono">${"{ACLI_TOKEN}"}</span>
								</FieldDescription>
							</Field>
						) : null}
					</FieldGroup>
				) : null}
			</FieldSet>
			<Field>
				<FieldLabel htmlFor={`${id}-git`}>
					Git host{" "}
					<span className="font-normal text-muted-foreground">(optional)</span>
				</FieldLabel>
				<Input
					id={`${id}-git`}
					value={draft.gitHost}
					onChange={(event) => set({ gitHost: event.target.value })}
					className="font-mono"
					autoComplete="off"
					spellCheck={false}
				/>
				<FieldDescription>
					In steps with this tool, git signs in to this host with its login.
					Works with programs that sign git in, such as gh. Example:{" "}
					<span className="font-mono">github.com</span>
				</FieldDescription>
			</Field>
		</>
	);
}

/** The login of a CLI tool on its page: what it reads, its folder, and Sign in. */
export function LoginSection({ tool }: { tool: CliTool }) {
	const queryClient = useQueryClient();
	const now = useNow(60_000);
	const signIn = useMutation(
		cliToolMutations.signIn({
			onSuccess: (result) => {
				void queryClient.invalidateQueries({
					queryKey: cliToolQueries.lists(),
				});
				void queryClient.invalidateQueries({
					queryKey: connectionQueries.lists(),
				});
				if (result.ok) toast.success(`Signed in ${tool.name}`);
			},
		}),
	);
	const login = tool.login;
	const result = signIn.data;
	const variables = Object.entries(login?.env ?? {});

	return (
		<DetailSection
			title="Login"
			description={
				login
					? "Only this tool gets these values. Agents and other tools do not see them."
					: "This tool uses the sign-in of this computer. Edit it to give it a login of its own."
			}
		>
			<div className="flex flex-col gap-4">
				<FactList
					facts={[
						...(tool.program
							? [
									{
										label: "Runs",
										value: <span className="font-mono">{tool.program}</span>,
									},
								]
							: []),
						...(variables.length > 0
							? [
									{
										label: "Variables",
										value: (
											<ul className="flex flex-col gap-1 font-mono text-xs leading-5">
												{variables.map(([key, value]) => (
													<li key={key} className="break-all">
														{key} = {value}
													</li>
												))}
											</ul>
										),
									},
								]
							: []),
						...(login?.folder
							? [
									{
										label: "Own folder",
										value: (
											<span>
												In <span className="font-mono">{login.folder}</span>
											</span>
										),
									},
								]
							: []),
						...(login?.signIn
							? [
									{
										label: "Signed in",
										value:
											tool.signedInAt !== null ? (
												<time
													dateTime={new Date(tool.signedInAt).toISOString()}
													title={formatDateTime(tool.signedInAt)}
												>
													{formatRelative(tool.signedInAt, now)}
												</time>
											) : (
												<span className="text-muted-foreground">
													Not yet. It signs in before its first step.
												</span>
											),
									},
								]
							: []),
						...(tool.git
							? [
									{
										label: "Git",
										value: <span className="font-mono">{tool.git.host}</span>,
									},
								]
							: []),
					]}
				/>
				{login?.signIn ? (
					<div>
						<Button
							variant="outline"
							size="sm"
							disabled={signIn.isPending}
							onClick={() => signIn.mutate({ name: tool.name })}
						>
							{signIn.isPending ? (
								<Spinner data-icon="inline-start" />
							) : (
								<KeyRoundIcon data-icon="inline-start" />
							)}
							{tool.signedInAt !== null ? "Sign in again" : "Sign in"}
						</Button>
					</div>
				) : null}
				{signIn.error ? (
					<Alert variant="destructive">
						<CircleAlertIcon />
						<AlertTitle>The sign-in did not run</AlertTitle>
						<AlertDescription>{signIn.error.message}</AlertDescription>
					</Alert>
				) : result && !result.ok ? (
					<Alert variant="destructive">
						<CircleAlertIcon />
						<AlertTitle>{tool.name} did not sign in</AlertTitle>
						<AlertDescription>
							Check the sign-in command and its secrets, then sign in again.
						</AlertDescription>
					</Alert>
				) : null}
				{result?.output ? (
					<CodeView
						code={result.output}
						language="text"
						title="What the sign-in printed"
						contentClassName="max-h-64"
					/>
				) : null}
			</div>
		</DetailSection>
	);
}
