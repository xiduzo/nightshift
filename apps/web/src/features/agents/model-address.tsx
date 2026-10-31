/** The address of a Model Profile (ADR 5): where its decider finds its server, with a test. */
import type { DeciderName } from "@nightshift/flows";
import { Alert, AlertDescription } from "@nightshift/ui/components/alert";
import { Button } from "@nightshift/ui/components/button";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
	FieldLegend,
	FieldSet,
} from "@nightshift/ui/components/field";
import { Input } from "@nightshift/ui/components/input";
import { Spinner } from "@nightshift/ui/components/spinner";
import { useMutation } from "@tanstack/react-query";
import { CircleAlertIcon, CircleCheckIcon } from "lucide-react";
import { useId } from "react";
import { DetailSection } from "@/shared/detail";
import { KeyValueRows } from "./connections/key-value-rows";
import {
	type AddressDraft,
	addressFrom,
	addressProblems,
} from "./model-address-draft";
import { deciderMutations } from "./queries";

/** What an address replaces, for a decider that has a default. */
const DEFAULTS: Partial<Record<DeciderName, string>> = {
	openai: "OpenAI's API",
	ollama: "the Ollama in the Meaning search settings",
};

export function ModelAddressSection({
	decider,
	required,
	draft,
	onChange,
	onModels,
}: {
	decider: DeciderName;
	required: boolean;
	draft: AddressDraft;
	onChange: (patch: Partial<AddressDraft>) => void;
	/** Gets the models the server lists, after a test that answered. */
	onModels: (models: string[]) => void;
}) {
	const id = useId();
	const test = useMutation(deciderMutations.modelsAt());
	const problems = addressProblems(draft, required);
	const address = addressFrom(draft);
	// A changed address needs a new test: an answer is for the address it tested.
	const current =
		JSON.stringify(test.variables?.address ?? null) ===
		JSON.stringify(address ?? null);
	const answer = current ? test.data : undefined;
	const failed = current ? test.error : null;
	const listed = answer?.models.slice(0, answer.listed) ?? [];
	const fallback = DEFAULTS[decider];

	return (
		<DetailSection
			title="Address"
			description={
				required || !fallback
					? "Where its server runs. Night Shift on this computer must reach it."
					: `Where its server runs. Leave it empty to use ${fallback}.`
			}
		>
			<FieldGroup>
				<Field data-invalid={problems.baseUrl ? true : undefined}>
					<FieldLabel htmlFor={`${id}-url`}>Base URL</FieldLabel>
					<Input
						id={`${id}-url`}
						value={draft.baseUrl}
						placeholder="http://127.0.0.1:8080"
						className="font-mono"
						autoComplete="off"
						spellCheck={false}
						aria-invalid={problems.baseUrl ? true : undefined}
						aria-describedby={`${id}-url-hint`}
						onChange={(event) => onChange({ baseUrl: event.target.value })}
					/>
					{problems.baseUrl && draft.baseUrl.trim() !== "" ? (
						<FieldError id={`${id}-url-hint`}>{problems.baseUrl}</FieldError>
					) : (
						<FieldDescription id={`${id}-url-hint`} className="text-xs">
							A server in a container on the Host network: http://openjev:8080.
						</FieldDescription>
					)}
				</Field>
				<Field data-invalid={problems.apiKey ? true : undefined}>
					<FieldLabel htmlFor={`${id}-key`}>API key secret</FieldLabel>
					<Input
						id={`${id}-key`}
						value={draft.apiKey}
						placeholder="OPENJEV_API_KEY"
						className="font-mono"
						autoComplete="off"
						spellCheck={false}
						aria-invalid={problems.apiKey ? true : undefined}
						aria-describedby={`${id}-key-hint`}
						onChange={(event) => onChange({ apiKey: event.target.value })}
					/>
					{problems.apiKey ? (
						<FieldError id={`${id}-key-hint`}>{problems.apiKey}</FieldError>
					) : (
						<FieldDescription id={`${id}-key-hint`} className="text-xs">
							Optional. Save the key on the Secrets page, then enter its name.
						</FieldDescription>
					)}
				</Field>
				<FieldSet className="gap-3">
					<FieldLegend variant="label">Headers</FieldLegend>
					<FieldDescription className="text-xs">
						Optional. Write a secret as{" "}
						<span className="font-mono">${"{NAME}"}</span> and save its value on
						the Secrets page.
					</FieldDescription>
					<KeyValueRows
						rows={draft.headers}
						onChange={(headers) => onChange({ headers })}
						keyLabel="Header"
						keyPlaceholder="X-Api-Key"
						valuePlaceholder="${PROXY_KEY}"
						addLabel="Add header"
					/>
				</FieldSet>
				<div className="flex flex-wrap items-center gap-3">
					<Button
						type="button"
						variant="outline"
						disabled={
							!address || Object.keys(problems).length > 0 || test.isPending
						}
						onClick={() => {
							if (!address) return;
							test.mutate(
								{ decider, address },
								{
									onSuccess: (result) => {
										if (result.problem === null) {
											onModels(result.models.slice(0, result.listed));
										}
									},
								},
							);
						}}
					>
						{test.isPending ? <Spinner data-icon="inline-start" /> : null}
						Test address
					</Button>
				</div>
				{failed ? (
					<Alert variant="destructive">
						<CircleAlertIcon />
						<AlertDescription>{failed.message}</AlertDescription>
					</Alert>
				) : answer?.problem ? (
					<Alert variant="destructive">
						<CircleAlertIcon />
						<AlertDescription>{answer.problem}</AlertDescription>
					</Alert>
				) : answer ? (
					<Alert>
						<CircleCheckIcon />
						<AlertDescription>
							{listed.length > 0
								? `It answers. It has ${listed.length === 1 ? "1 model" : `${listed.length} models`}: ${listed.slice(0, 5).join(", ")}${listed.length > 5 ? ", …" : ""}.`
								: "It answers, but it lists no models."}
						</AlertDescription>
					</Alert>
				) : null}
			</FieldGroup>
		</DetailSection>
	);
}
