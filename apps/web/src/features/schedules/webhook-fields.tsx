import { webhookPath } from "@nightshift/flows";
import {
	Field,
	FieldContent,
	FieldDescription,
	FieldGroup,
	FieldLabel,
} from "@nightshift/ui/components/field";
import { Input } from "@nightshift/ui/components/input";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupInput,
} from "@nightshift/ui/components/input-group";
import { Switch } from "@nightshift/ui/components/switch";
import { CopyIcon } from "lucide-react";
import { toast } from "sonner";
import { SERVER_URL } from "@/shared/api";

/** What the webhook part of the schedule form edits. */
export type WebhookForm = {
	/** The secret's name, without `${…}`. */
	secret: string;
	/** The JSONata rule, or "" for every webhook. */
	when: string;
	signal: { on: boolean; name: string; key: string };
};

/** The address a schedule's webhook goes to, on the Night Shift this page talks to. */
export function webhookAddress(projectId: string, scheduleId: string): string {
	return `${SERVER_URL}${webhookPath(projectId, scheduleId)}`;
}

async function copyAddress(address: string) {
	try {
		await navigator.clipboard.writeText(address);
		toast.success("Address copied");
	} catch {
		toast.error("Could not copy. Allow this page to use the clipboard.");
	}
}

/** The address to paste into the sender, with a copy button. */
export function WebhookAddress({
	id,
	address,
}: {
	id: string;
	address: string;
}) {
	return (
		<Field>
			<FieldLabel htmlFor={id}>Address</FieldLabel>
			<InputGroup>
				<InputGroupInput
					id={id}
					value={address}
					readOnly
					className="font-mono text-xs"
					onFocus={(event) => event.currentTarget.select()}
				/>
				<InputGroupAddon align="inline-end">
					<InputGroupButton
						aria-label="Copy the address"
						onClick={() => void copyAddress(address)}
					>
						<CopyIcon />
					</InputGroupButton>
				</InputGroupAddon>
			</InputGroup>
			<FieldDescription>
				In GitHub, paste it as the payload URL and choose application/json. The
				sender must reach this address from the internet.
			</FieldDescription>
		</Field>
	);
}

/**
 * The webhook of a schedule: its address, the secret the sender proves it
 * knows, an optional rule, and the signal it sends to waiting runs.
 */
export function WebhookFields({
	idPrefix,
	address,
	value,
	onChange,
}: {
	idPrefix: string;
	address: string;
	value: WebhookForm;
	onChange: (value: WebhookForm) => void;
}) {
	const { signal } = value;
	return (
		<FieldGroup className="gap-5">
			<WebhookAddress id={`${idPrefix}-address`} address={address} />
			<Field>
				<FieldLabel htmlFor={`${idPrefix}-secret`}>Secret</FieldLabel>
				<Input
					id={`${idPrefix}-secret`}
					value={value.secret}
					placeholder="GITHUB_HOOK_SECRET"
					className="font-mono"
					autoComplete="off"
					spellCheck={false}
					onChange={(event) =>
						onChange({ ...value, secret: event.target.value.trim() })
					}
				/>
				<FieldDescription>
					The name of a secret on the Secrets page. In GitHub, enter its value
					as the webhook secret. Another sender sends it as Authorization:
					Bearer and the value.
				</FieldDescription>
			</Field>
			<Field>
				<FieldLabel htmlFor={`${idPrefix}-when`}>
					Only when
					<span className="font-normal text-muted-foreground">(optional)</span>
				</FieldLabel>
				<Input
					id={`${idPrefix}-when`}
					value={value.when}
					placeholder='event.body.action = "opened"'
					className="font-mono"
					autoComplete="off"
					spellCheck={false}
					onChange={(event) => onChange({ ...value, when: event.target.value })}
				/>
				<FieldDescription>
					A JSONata rule. Night Shift skips each webhook that does not match it.
				</FieldDescription>
			</Field>
			<Field orientation="horizontal" className="items-start">
				<Switch
					id={`${idPrefix}-signal`}
					checked={signal.on}
					className="mt-0.5"
					onCheckedChange={(on) =>
						onChange({ ...value, signal: { ...signal, on } })
					}
				/>
				<FieldContent>
					<FieldLabel htmlFor={`${idPrefix}-signal`}>
						Wake waiting runs
					</FieldLabel>
					<FieldDescription>
						Runs of this project that wait for this signal continue. They get
						the webhook as their data.
					</FieldDescription>
				</FieldContent>
			</Field>
			{signal.on ? (
				<div className="grid gap-3 sm:grid-cols-2">
					<Field>
						<FieldLabel htmlFor={`${idPrefix}-signal-name`}>Signal</FieldLabel>
						<Input
							id={`${idPrefix}-signal-name`}
							value={signal.name}
							placeholder="ci-done"
							className="font-mono"
							autoComplete="off"
							spellCheck={false}
							onChange={(event) =>
								onChange({
									...value,
									signal: { ...signal, name: event.target.value.trim() },
								})
							}
						/>
					</Field>
					<Field>
						<FieldLabel htmlFor={`${idPrefix}-signal-key`}>
							Key
							<span className="font-normal text-muted-foreground">
								(optional)
							</span>
						</FieldLabel>
						<Input
							id={`${idPrefix}-signal-key`}
							value={signal.key}
							placeholder="event.body.number"
							className="font-mono"
							autoComplete="off"
							spellCheck={false}
							onChange={(event) =>
								onChange({
									...value,
									signal: { ...signal, key: event.target.value },
								})
							}
						/>
					</Field>
					<FieldDescription className="sm:col-span-2">
						With a key, only a wait with the same key continues.
					</FieldDescription>
				</div>
			) : null}
		</FieldGroup>
	);
}
