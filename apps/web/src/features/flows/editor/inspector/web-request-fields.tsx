/** The fields of a Web request node: where it goes, what it sends, and its limits. */
import {
	DEFAULT_WEB_REQUEST_MAX_BYTES,
	DEFAULT_WEB_REQUEST_TIMEOUT_SECONDS,
	type Flow,
	MAX_WEB_REQUEST_BYTES,
	WEB_REQUEST_METHODS,
	type WebRequestMethod,
	type WebRequestNode,
} from "@nightshift/flows";
import { Button } from "@nightshift/ui/components/button";
import {
	FieldDescription,
	FieldLegend,
	FieldSet,
} from "@nightshift/ui/components/field";
import { Input } from "@nightshift/ui/components/input";
import {
	NativeSelect,
	NativeSelectOption,
} from "@nightshift/ui/components/native-select";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "@nightshift/ui/components/toggle-group";
import { PlusIcon, XIcon } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { Field, InspectorSection, Note, PositiveIntInput } from "../fields";
import { TemplateField } from "../template-field";
import { DataShapeSection } from "./data-shape-section";

type WebRequestBody = NonNullable<WebRequestNode["body"]>;
type BodyKind = WebRequestBody["kind"] | "none";

const BODY_KINDS: { value: BodyKind; label: string }[] = [
	{ value: "none", label: "None" },
	{ value: "json", label: "JSON" },
	{ value: "text", label: "Text" },
	{ value: "form", label: "Form" },
];

/** What a body of each kind starts with. */
function emptyBody(kind: WebRequestBody["kind"]): WebRequestBody {
	switch (kind) {
		case "json":
			return { kind: "json", value: "{}" };
		case "text":
			return { kind: "text", value: "" };
		case "form":
			return { kind: "form", fields: {} };
	}
}

const MB = 1024 * 1024;

/** A toggle item that fills its share and shows when it is on. */
const PRESSED =
	"flex-1 aria-pressed:bg-primary aria-pressed:text-primary-foreground";

export function WebRequestFields({
	flow,
	node,
	onChange,
}: {
	flow: Flow;
	node: WebRequestNode;
	onChange: (change: (node: WebRequestNode) => WebRequestNode) => void;
}) {
	const id = useId();
	const fromSecret = node.urlSecret !== undefined;
	const noBody = node.method === "GET" || node.method === "HEAD";
	const body = node.body;

	return (
		<>
			<InspectorSection title="Request">
				<Field id={`${id}-method`} label="Method">
					<NativeSelect
						id={`${id}-method`}
						className="font-mono"
						value={node.method}
						onChange={(event) => {
							const method = event.target.value as WebRequestMethod;
							onChange((current) => ({ ...current, method }));
						}}
					>
						{WEB_REQUEST_METHODS.map((method) => (
							<NativeSelectOption key={method} value={method}>
								{method}
							</NativeSelectOption>
						))}
					</NativeSelect>
				</Field>

				<Field id={`${id}-where`} label="Send to">
					<ToggleGroup
						variant="outline"
						size="sm"
						spacing={0}
						aria-label="Send to"
						className="w-full"
						value={[fromSecret ? "secret" : "url"]}
						onValueChange={(value) => {
							const next = value[0];
							if (next === undefined) return;
							onChange((current) => {
								const { url: _, urlSecret: __, ...rest } = current;
								return next === "secret"
									? { ...rest, urlSecret: "" }
									: { ...rest, url: "" };
							});
						}}
					>
						<ToggleGroupItem value="url" className={PRESSED}>
							A URL
						</ToggleGroupItem>
						<ToggleGroupItem value="secret" className={PRESSED}>
							A secret
						</ToggleGroupItem>
					</ToggleGroup>
				</Field>

				{fromSecret ? (
					<TemplateField
						id={`${id}-secret`}
						label="Secret that holds the URL"
						hint="For a webhook address, which is a key itself. Night Shift never shows it."
						flow={flow}
						nodeId={node.id}
						value={node.urlSecret ?? ""}
						placeholder="SLACK_WEBHOOK_URL"
						multiline={false}
						invalid={(node.urlSecret ?? "").trim() === ""}
						onChange={(urlSecret) =>
							onChange((current) => ({ ...current, urlSecret }))
						}
					/>
				) : (
					<TemplateField
						id={`${id}-url`}
						label="URL"
						hint="Write ${API_KEY} to use a secret."
						flow={flow}
						nodeId={node.id}
						value={node.url ?? ""}
						placeholder="https://api.example.com/items"
						multiline={false}
						invalid={(node.url ?? "").trim() === ""}
						onChange={(url) => onChange((current) => ({ ...current, url }))}
					/>
				)}

				<NamedTemplates
					flow={flow}
					nodeId={node.id}
					legend="Query"
					what="query value"
					namePlaceholder="q"
					valuePlaceholder="{{topic}}"
					values={node.query ?? {}}
					onChange={(query) =>
						onChange((current) => withRecord(current, "query", query))
					}
				/>

				<NamedTemplates
					flow={flow}
					nodeId={node.id}
					legend="Headers"
					hint="Write ${API_TOKEN} to use a secret: Bearer ${API_TOKEN}."
					what="header"
					namePlaceholder="Authorization"
					valuePlaceholder="Bearer ${API_TOKEN}"
					values={node.headers ?? {}}
					onChange={(headers) =>
						onChange((current) => withRecord(current, "headers", headers))
					}
				/>

				{noBody && body === undefined ? null : (
					<Field
						id={`${id}-body`}
						label="Body"
						error={
							noBody
								? `A ${node.method} request sends no body. Use POST, or pick None.`
								: null
						}
					>
						<ToggleGroup
							variant="outline"
							size="sm"
							spacing={0}
							aria-label="Body"
							className="w-full"
							value={[body?.kind ?? "none"]}
							onValueChange={(value) => {
								const next = value[0] as BodyKind | undefined;
								if (next === undefined) return;
								onChange((current) => {
									const { body: _, ...rest } = current;
									return next === "none"
										? rest
										: { ...rest, body: emptyBody(next) };
								});
							}}
						>
							{BODY_KINDS.map((kind) => (
								<ToggleGroupItem
									key={kind.value}
									value={kind.value}
									className={PRESSED}
								>
									{kind.label}
								</ToggleGroupItem>
							))}
						</ToggleGroup>
					</Field>
				)}

				{body?.kind === "json" ? (
					<TemplateField
						id={`${id}-json`}
						label="JSON"
						hint='Put each template in quotes: "{{plan.data.tasks}}". A quoted template that is one reference keeps its JSON value.'
						flow={flow}
						nodeId={node.id}
						value={body.value}
						language="json"
						className="min-h-24"
						placeholder='{"text": "{{summary}}"}'
						onChange={(value) =>
							onChange((current) => ({
								...current,
								body: { kind: "json", value },
							}))
						}
					/>
				) : null}

				{body?.kind === "text" ? (
					<>
						<TemplateField
							id={`${id}-text`}
							label="Text"
							flow={flow}
							nodeId={node.id}
							value={body.value}
							className="min-h-24"
							onChange={(value) =>
								onChange((current) =>
									current.body?.kind === "text"
										? { ...current, body: { ...current.body, value } }
										: current,
								)
							}
						/>
						<Field id={`${id}-type`} label="Content type" optional>
							<Input
								id={`${id}-type`}
								value={body.contentType ?? ""}
								placeholder="text/plain; charset=utf-8"
								className="font-mono"
								autoComplete="off"
								spellCheck={false}
								onChange={(event) => {
									const contentType = event.target.value;
									onChange((current) => {
										if (current.body?.kind !== "text") return current;
										const { contentType: _, ...rest } = current.body;
										return {
											...current,
											body:
												contentType.trim() === ""
													? rest
													: { ...rest, contentType },
										};
									});
								}}
							/>
						</Field>
					</>
				) : null}

				{body?.kind === "form" ? (
					<NamedTemplates
						flow={flow}
						nodeId={node.id}
						legend="Form fields"
						what="field"
						namePlaceholder="name"
						valuePlaceholder="{{lead.name}}"
						values={body.fields}
						onChange={(fields) =>
							onChange((current) => ({
								...current,
								body: { kind: "form", fields },
							}))
						}
					/>
				) : null}

				<Note>
					The step ends <code>pass</code> on a 2xx answer, else{" "}
					<code>fail</code>. When the server is busy or down, the step waits and
					asks again. Later nodes read <code>{`{{${node.id}.status}}`}</code>,{" "}
					<code>{`{{${node.id}.body}}`}</code> and{" "}
					<code>{`{{${node.id}.headers.content-type}}`}</code>.
				</Note>
			</InspectorSection>

			<DataShapeSection node={node} onChange={onChange} label="Body shape" />

			<InspectorSection title="Answer" tab="setup" defaultOpen={false}>
				<Field
					id={`${id}-timeout`}
					label="Time limit (seconds)"
					optional
					hint={`Default ${DEFAULT_WEB_REQUEST_TIMEOUT_SECONDS} seconds.`}
				>
					<PositiveIntInput
						id={`${id}-timeout`}
						value={node.timeoutSeconds}
						placeholder={String(DEFAULT_WEB_REQUEST_TIMEOUT_SECONDS)}
						onChange={(timeoutSeconds) =>
							onChange((current) => {
								const { timeoutSeconds: _, ...rest } = current;
								return timeoutSeconds === undefined
									? rest
									: { ...rest, timeoutSeconds: Math.min(timeoutSeconds, 600) };
							})
						}
					/>
				</Field>
				<Field
					id={`${id}-size`}
					label="Size limit (MB)"
					optional
					hint={`Default ${DEFAULT_WEB_REQUEST_MAX_BYTES / MB} MB, at most ${MAX_WEB_REQUEST_BYTES / MB} MB. A larger answer ends the step fail.`}
				>
					<PositiveIntInput
						id={`${id}-size`}
						value={
							node.maxBytes === undefined
								? undefined
								: Math.max(1, Math.round(node.maxBytes / MB))
						}
						placeholder={String(DEFAULT_WEB_REQUEST_MAX_BYTES / MB)}
						onChange={(megabytes) =>
							onChange((current) => {
								const { maxBytes: _, ...rest } = current;
								return megabytes === undefined
									? rest
									: {
											...rest,
											maxBytes: Math.min(megabytes * MB, MAX_WEB_REQUEST_BYTES),
										};
							})
						}
					/>
				</Field>
			</InspectorSection>
		</>
	);
}

/** The node with a record field set, or left out when it is empty. */
function withRecord(
	node: WebRequestNode,
	key: "query" | "headers",
	values: Record<string, string>,
): WebRequestNode {
	const next: WebRequestNode = { ...node };
	if (Object.keys(values).length === 0) delete next[key];
	else next[key] = values;
	return next;
}

/**
 * A list of names, each with a template: the query of a request, its
 * headers, the fields of a form. A name is added below, and each one can go.
 */
export function NamedTemplates({
	flow,
	nodeId,
	legend,
	hint,
	what,
	namePlaceholder,
	valuePlaceholder,
	values,
	onChange,
}: {
	flow: Flow;
	nodeId: string;
	legend: string;
	hint?: ReactNode;
	/** What one entry is called, for the buttons: "header". */
	what: string;
	namePlaceholder: string;
	valuePlaceholder: string;
	values: Record<string, string>;
	onChange: (values: Record<string, string>) => void;
}) {
	const id = useId();
	const [adding, setAdding] = useState("");
	const trimmed = adding.trim();
	const taken = Object.hasOwn(values, trimmed);
	const add = () => {
		if (trimmed === "" || taken) return;
		onChange({ ...values, [trimmed]: "" });
		setAdding("");
	};
	return (
		<FieldSet className="gap-3">
			<div className="flex flex-col gap-1">
				<FieldLegend variant="label" className="mb-0">
					{legend}
				</FieldLegend>
				{hint ? (
					<FieldDescription className="text-xs">{hint}</FieldDescription>
				) : null}
			</div>
			{Object.entries(values).map(([name, value]) => (
				<TemplateField
					key={name}
					id={`${id}-${name}`}
					label={
						<span className="flex min-w-0 items-center gap-1.5">
							<span className="font-mono">{name}</span>
							<Button
								variant="ghost"
								size="icon-xs"
								className="ml-auto"
								aria-label={`Remove the ${what} ${name}`}
								title={`Remove this ${what}`}
								onClick={() => {
									const next = { ...values };
									delete next[name];
									onChange(next);
								}}
							>
								<XIcon />
							</Button>
						</span>
					}
					flow={flow}
					nodeId={nodeId}
					value={value}
					multiline={false}
					placeholder={valuePlaceholder}
					onChange={(next) => onChange({ ...values, [name]: next })}
				/>
			))}
			<div className="flex items-start gap-1.5">
				<Input
					value={adding}
					placeholder={namePlaceholder}
					className="h-8 min-w-0 flex-1 font-mono text-xs"
					autoComplete="off"
					spellCheck={false}
					aria-label={`New ${what} name`}
					aria-invalid={trimmed !== "" && taken}
					onChange={(event) => setAdding(event.target.value)}
					onKeyDown={(event) => {
						if (event.key !== "Enter") return;
						event.preventDefault();
						add();
					}}
				/>
				<Button
					variant="outline"
					size="sm"
					disabled={trimmed === "" || taken}
					onClick={add}
				>
					<PlusIcon data-icon="inline-start" />
					Add {what}
				</Button>
			</div>
		</FieldSet>
	);
}
