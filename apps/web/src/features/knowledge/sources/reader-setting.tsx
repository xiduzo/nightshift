import {
	PAGE_READER_DEFAULTS,
	type PageReaderSetting,
} from "@nightshift/flows";
import {
	Alert,
	AlertAction,
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
} from "@nightshift/ui/components/field";
import { Input } from "@nightshift/ui/components/input";
import {
	NativeSelect,
	NativeSelectOption,
} from "@nightshift/ui/components/native-select";
import { Spinner } from "@nightshift/ui/components/spinner";
import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { KeyRoundIcon } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { useKnowledge } from "../layout";
import { knowledgeMutations } from "../queries";

type ReaderKind = PageReaderSetting["kind"];

const READERS: { kind: ReaderKind; label: string }[] = [
	{ kind: "nightshift", label: "Night Shift" },
	{ kind: "jina", label: "Jina Reader" },
	{ kind: "firecrawl", label: "Firecrawl" },
];

/** The setting as the form edits it: empty text is the default. */
type Draft = { kind: ReaderKind; address: string; secret: string };

function draftOf(reader: PageReaderSetting): Draft {
	return reader.kind === "nightshift"
		? { kind: "nightshift", address: "", secret: "" }
		: {
				kind: reader.kind,
				address: reader.address ?? "",
				secret: reader.secret ?? "",
			};
}

function settingOf(draft: Draft): PageReaderSetting {
	if (draft.kind === "nightshift") return { kind: "nightshift" };
	const address = draft.address.trim();
	const secret = draft.secret.trim();
	return {
		kind: draft.kind,
		...(address ? { address } : {}),
		...(secret ? { secret } : {}),
	};
}

const same = (a: PageReaderSetting, b: PageReaderSetting) =>
	JSON.stringify(settingOf(draftOf(a))) ===
	JSON.stringify(settingOf(draftOf(b)));

/**
 * What reads the web pages of the project's knowledge: Night Shift on the
 * computer that syncs, or Jina Reader or Firecrawl, at their own address or
 * one you host, with the secret that holds the key. It holds for every
 * computer of the Space.
 */
export function ReaderSetting() {
	const { projectId, knowledge } = useKnowledge();
	const id = useId();
	const saved = knowledge.reader;
	const [draft, setDraft] = useState<Draft>(() => draftOf(saved));
	const set = useMutation(
		knowledgeMutations.setReader({
			onSuccess: (reader) => setDraft(draftOf(reader)),
			onError: (error) =>
				toast.error(`The page reader was not saved: ${error.message}`),
		}),
	);
	const may = knowledge.can.startRuns;
	const next = settingOf(draft);
	const changed = !same(next, saved);
	const service =
		draft.kind === "nightshift" ? null : PAGE_READER_DEFAULTS[draft.kind];
	const secretName =
		saved.kind === "nightshift"
			? null
			: (saved.secret ?? PAGE_READER_DEFAULTS[saved.kind].secret);
	// Firecrawl's own service reads nothing without a key. Jina Reader reads slower.
	const needsKey =
		saved.kind === "firecrawl" &&
		saved.address === undefined &&
		!knowledge.readerReady;
	const fasterWithKey = saved.kind === "jina" && !knowledge.readerReady;

	return (
		<div className="flex flex-col gap-3 rounded-xl border p-4">
			<FieldGroup className="gap-4">
				<Field orientation="horizontal">
					<FieldContent>
						<FieldLabel htmlFor={`${id}-kind`}>Page reader</FieldLabel>
						<FieldDescription>
							What reads the web pages you add. Jina Reader and Firecrawl read
							pages that need a browser.
						</FieldDescription>
					</FieldContent>
					<NativeSelect
						id={`${id}-kind`}
						className="w-40"
						disabled={!may || set.isPending}
						value={draft.kind}
						onChange={(event) =>
							setDraft({
								kind: event.target.value as ReaderKind,
								address: "",
								secret: "",
							})
						}
					>
						{READERS.map((reader) => (
							<NativeSelectOption key={reader.kind} value={reader.kind}>
								{reader.label}
							</NativeSelectOption>
						))}
					</NativeSelect>
				</Field>
				{service ? (
					<div className="grid gap-4 sm:grid-cols-2">
						<Field>
							<FieldLabel htmlFor={`${id}-address`}>Address</FieldLabel>
							<Input
								id={`${id}-address`}
								value={draft.address}
								placeholder={service.address}
								disabled={!may}
								onChange={(event) =>
									setDraft((now) => ({ ...now, address: event.target.value }))
								}
							/>
							<FieldDescription>
								Change it only for a service you host.
							</FieldDescription>
						</Field>
						<Field>
							<FieldLabel htmlFor={`${id}-secret`}>
								Secret with the key
							</FieldLabel>
							<Input
								id={`${id}-secret`}
								value={draft.secret}
								placeholder={service.secret}
								disabled={!may}
								className="font-mono"
								onChange={(event) =>
									setDraft((now) => ({ ...now, secret: event.target.value }))
								}
							/>
						</Field>
					</div>
				) : null}
			</FieldGroup>
			{changed ? (
				<div className="flex justify-end gap-2">
					<Button
						variant="outline"
						disabled={set.isPending}
						onClick={() => setDraft(draftOf(saved))}
					>
						Cancel
					</Button>
					<Button
						disabled={set.isPending}
						onClick={() => set.mutate({ projectId, reader: next })}
					>
						{set.isPending ? <Spinner data-icon="inline-start" /> : null}
						Save reader
					</Button>
				</div>
			) : secretName && (needsKey || fasterWithKey) ? (
				<Alert variant={needsKey ? "destructive" : "default"}>
					<KeyRoundIcon />
					<AlertTitle>
						{needsKey
							? `Save ${secretName} on the Secrets page first`
							: `Save ${secretName} on the Secrets page to read faster`}
					</AlertTitle>
					<AlertDescription>
						{needsKey
							? "Firecrawl reads no page without its key."
							: "Without a key, the reader takes fewer pages a minute."}
					</AlertDescription>
					<AlertAction>
						<Button
							size="sm"
							variant="outline"
							nativeButton={false}
							render={<Link to="/secrets" />}
						>
							Open Secrets
						</Button>
					</AlertAction>
				</Alert>
			) : null}
		</div>
	);
}
