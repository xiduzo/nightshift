import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import { Card, CardContent } from "@nightshift/ui/components/card";
import {
	Combobox,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxInput,
	ComboboxItem,
	ComboboxList,
} from "@nightshift/ui/components/combobox";
import {
	Field,
	FieldDescription,
	FieldGroup,
	FieldLabel,
	FieldSeparator,
} from "@nightshift/ui/components/field";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { Progress } from "@nightshift/ui/components/progress";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { Spinner } from "@nightshift/ui/components/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DownloadIcon } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import type { SettingsView } from "@/shared/api";
import { PageSection } from "@/shared/page";
import { type SettingsForm, useSettingsForm } from "../hooks/use-settings-form";
import { ollamaMutations, ollamaQueries } from "../queries";
import {
	CardForm,
	HeadersCard,
	ResetSection,
	SaveError,
	SelectSetting,
	TextSetting,
} from "./setting-fields";

const MEANING_KEYS = ["ollama", "embeddingModel", "ollamaAddress"] as const;

/** Embedding models that work well, with what each is good at. */
const SHORTLIST: readonly { name: string; about: string }[] = [
	{ name: "qwen3-embedding:0.6b", about: "Default. Reads many languages." },
	{ name: "embeddinggemma", about: "Small. Reads many languages." },
	{ name: "bge-m3", about: "Reads many languages. Larger." },
	{ name: "nomic-embed-text", about: "English. Small and fast." },
];

/** How often the status is asked again while a download runs, and otherwise. */
const DOWNLOAD_POLL = 1500;
const STATUS_POLL = 15_000;

/**
 * "Meaning search": whether Night Shift starts Ollama, which embedding
 * model search uses, and which Ollama, with the headers of a proxy in
 * front of it. One line says how that Ollama is now, with a Download
 * button for a model it lacks.
 */
export function MeaningSearchCard({ data }: { data: SettingsView }) {
	const form = useSettingsForm(data, MEANING_KEYS, { title: "Meaning search" });
	const off = data.values.ollama === "off";
	const elsewhere = data.values.ollamaAddress.trim() !== "";
	const modes = [
		{
			value: "auto",
			label: data.values.host
				? "Start Ollama on this Host"
				: "Use Ollama when it runs",
		},
		{ value: "on", label: "Start Ollama with Night Shift" },
		{ value: "off", label: "Off: find by words only" },
	] as const;

	return (
		<PageSection
			title="Meaning search"
			description="Search finds files by what they mean, not only by their words. Ollama does this, on this computer or on one you choose."
			actions={<ResetSection form={form} />}
		>
			<Card>
				<CardForm form={form}>
					<CardContent>
						<FieldGroup>
							{off ? null : <OllamaLine />}
							<SelectSetting
								form={form}
								settingKey="ollama"
								label="Search by meaning"
								options={modes}
							/>
							{off ? null : (
								<>
									<FieldSeparator />
									<div className="grid gap-6 sm:grid-cols-2">
										<ModelField form={form} />
										<TextSetting
											form={form}
											settingKey="ollamaAddress"
											label="Ollama address"
											placeholder="On this computer"
											description="With another address, Night Shift sends your knowledge text to that computer, where the model reads it."
											mono
										/>
									</div>
								</>
							)}
							<SaveError error={form.saveError} />
						</FieldGroup>
					</CardContent>
				</CardForm>
			</Card>
			{off || !elsewhere ? null : (
				<HeadersCard
					key={JSON.stringify(data.values.ollamaHeaders)}
					settingKey="ollamaHeaders"
					saved={data.values.ollamaHeaders}
					description={
						<>
							For an Ollama behind a proxy that asks for a key. Write a key as{" "}
							<span className="font-mono">${"{NAME}"}</span> and save its value
							on the Secrets page.
						</>
					}
					valuePlaceholder="Bearer ${OLLAMA_TOKEN}"
				/>
			)}
		</PageSection>
	);
}

/** The model search embeds with: a model this Ollama has, one of the shortlist, or any other name. */
function ModelField({ form }: { form: SettingsForm }) {
	const id = useId();
	const models = useQuery({
		...ollamaQueries.models(),
		staleTime: 60_000,
		meta: { quietErrors: true },
	});
	const have = (models.data ?? []).map((m) => m.name);
	const names = [
		...new Set([
			...SHORTLIST.map((m) => m.name),
			...have.map((name) => name.replace(/:latest$/, "")),
		]),
	];
	const value = form.value("embeddingModel");
	const error = form.error("embeddingModel");
	const [typed, setTyped] = useState(false);
	const query = value.trim().toLowerCase();
	const shown = typed
		? names.filter((name) => name.toLowerCase().includes(query))
		: names;
	const about = (name: string) => {
		const known = SHORTLIST.find((m) => m.name === name)?.about;
		const downloaded = have.includes(name) || have.includes(`${name}:latest`);
		return [known, downloaded ? "Downloaded." : null].filter(Boolean).join(" ");
	};

	return (
		<Field data-invalid={error ? true : undefined}>
			<FieldLabel htmlFor={id}>Model</FieldLabel>
			<Combobox
				items={names}
				filteredItems={shown}
				filter={null}
				value={names.includes(value) ? value : null}
				inputValue={value}
				onInputValueChange={(next) => {
					setTyped(true);
					form.set("embeddingModel", next);
				}}
				onValueChange={(next: string | null) => {
					if (next) form.set("embeddingModel", next);
				}}
				onOpenChange={(open) => {
					if (open) setTyped(false);
				}}
			>
				<ComboboxInput
					id={id}
					className="w-full font-mono"
					placeholder="qwen3-embedding:0.6b"
					autoComplete="off"
					spellCheck={false}
					aria-invalid={error ? true : undefined}
					aria-describedby={`${id}-description`}
					onBlur={form.flush}
				/>
				<ComboboxContent>
					<ComboboxEmpty>
						Not in the list. Ollama takes any embedding model it can download.
					</ComboboxEmpty>
					<ComboboxList>
						{(name: string) => (
							<ComboboxItem key={name} value={name}>
								<div className="flex flex-col">
									<span className="font-mono">{name}</span>
									{about(name) ? (
										<span className="text-muted-foreground text-xs">
											{about(name)}
										</span>
									) : null}
								</div>
							</ComboboxItem>
						)}
					</ComboboxList>
				</ComboboxContent>
			</Combobox>
			{error ? (
				<FieldDescription className="text-destructive">
					{error}
				</FieldDescription>
			) : null}
			<FieldDescription id={`${id}-description`}>
				A new model prepares the search again.
			</FieldDescription>
		</Field>
	);
}

/** Which Ollama search uses, how it is now, and a download of a model it lacks. */
function OllamaLine() {
	const queryClient = useQueryClient();
	const status = useQuery({
		...ollamaQueries.status(),
		refetchInterval: (query) =>
			query.state.data?.download?.running ? DOWNLOAD_POLL : STATUS_POLL,
	});
	const pull = useMutation(
		ollamaMutations.pull({
			onSuccess: () => {
				void queryClient.invalidateQueries({
					queryKey: ollamaQueries.status().queryKey,
				});
			},
			onError: (error) => toast.error(`Not downloaded: ${error.message}`),
		}),
	);
	const s = status.data;
	if (!s) return <Skeleton className="h-16 w-full rounded-lg" />;

	const title = s.where ? `Ollama at ${s.where}` : "Ollama on this computer";
	const running = s.download?.running ?? false;
	const download =
		s.answers && !s.hasModel && !running ? (
			<Button
				type="button"
				variant="outline"
				size="sm"
				disabled={pull.isPending}
				onClick={() => pull.mutate({ model: s.model })}
			>
				{pull.isPending ? (
					<Spinner data-icon="inline-start" />
				) : (
					<DownloadIcon data-icon="inline-start" />
				)}
				Download
			</Button>
		) : null;

	let badge: {
		label: string;
		variant: "secondary" | "outline" | "destructive";
	};
	let description: string;
	if (s.missingSecrets.length > 0) {
		badge = { label: "Needs a secret", variant: "destructive" };
		description = `Save the secret ${s.missingSecrets.join(", ")} on the Secrets page.`;
	} else if (!s.answers) {
		badge = { label: "Does not answer", variant: "destructive" };
		description = s.where
			? `Ollama at ${s.where} does not answer. Check the address, and that Ollama runs there.`
			: s.installed
				? "Ollama does not answer. Start Ollama, or let Night Shift start it."
				: "Ollama is not on this computer. Install it from ollama.com, or use another address.";
	} else if (running) {
		badge = { label: `${s.download?.percent ?? 0}%`, variant: "secondary" };
		description = `Night Shift downloads ${s.model}. Search finds words until it is ready.`;
	} else if (!s.hasModel) {
		badge = { label: "No model", variant: "outline" };
		description = s.download?.error
			? `The download of ${s.model} stopped: ${s.download.error}`
			: `Ollama does not have ${s.model}. Download it to find files by meaning.`;
	} else {
		badge = { label: "Ready", variant: "secondary" };
		description = `Search finds files by meaning with ${s.model}.`;
	}

	return (
		<Item variant="muted" size="sm">
			<ItemContent>
				<ItemTitle>
					{title}
					<Badge variant={badge.variant}>{badge.label}</Badge>
					{s.started ? (
						<Badge variant="outline">Started by Night Shift</Badge>
					) : null}
				</ItemTitle>
				<ItemDescription>{description}</ItemDescription>
				{running ? (
					<Progress
						value={s.download?.percent ?? 0}
						aria-label={`Download of ${s.model}`}
						className="mt-2"
					/>
				) : null}
			</ItemContent>
			{download ? <ItemActions>{download}</ItemActions> : null}
		</Item>
	);
}
