import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import { Card, CardContent } from "@nightshift/ui/components/card";
import {
	Field,
	FieldContent,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
	FieldSeparator,
} from "@nightshift/ui/components/field";
import { Spinner } from "@nightshift/ui/components/spinner";
import { Switch } from "@nightshift/ui/components/switch";
import { Textarea } from "@nightshift/ui/components/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { InfoIcon } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import type { SettingsView } from "@/shared/api";
import { PageSection } from "@/shared/page";
import { useSettingsForm, useToggleSetting } from "../hooks/use-settings-form";
import { settingsMutations, settingsQueries } from "../queries";
import {
	CardForm,
	ResetSection,
	SaveError,
	SelectSetting,
	TextSetting,
} from "./setting-fields";

const MONITORING_KEYS = ["telemetryEndpoint", "telemetryProtocol"] as const;

const FORMATS = [
	{ value: "http/protobuf", label: "Protobuf (most tools)" },
	{ value: "http/json", label: "JSON" },
] as const;

/** "Send runs to your monitoring": off by default, an address, a format and headers. */
export function MonitoringCard({ data }: { data: SettingsView }) {
	const form = useSettingsForm(data, MONITORING_KEYS, { title: "Monitoring" });
	const toggle = useToggleSetting("Monitoring");
	const id = useId();
	const on = data.values.telemetry;
	const noAddress = on && data.values.telemetryEndpoint.trim() === "";

	return (
		<PageSection
			title="Monitoring"
			description="Send your runs to a monitoring tool you choose, such as Grafana. Nothing leaves this computer until you turn it on."
			actions={<ResetSection form={form} />}
		>
			<Card>
				<CardForm form={form}>
					<CardContent>
						<FieldGroup>
							<Field orientation="horizontal">
								<FieldContent>
									<FieldLabel htmlFor={`${id}-telemetry`}>
										Send runs to your monitoring
									</FieldLabel>
									<FieldDescription>
										Night Shift sends each run with its steps, time, tokens and
										cost. Claude Code steps send their own usage there too.
										Prompts and replies stay on this computer.
									</FieldDescription>
								</FieldContent>
								<Switch
									id={`${id}-telemetry`}
									checked={on}
									disabled={toggle.isPending}
									onCheckedChange={(checked) =>
										toggle.mutate({ telemetry: checked })
									}
								/>
							</Field>
							{noAddress ? (
								<Alert>
									<InfoIcon />
									<AlertTitle>Add an address</AlertTitle>
									<AlertDescription>
										Night Shift starts to send your runs when you add the
										address of your monitoring tool.
									</AlertDescription>
								</Alert>
							) : null}
							<FieldSeparator />
							<div className="grid gap-6 sm:grid-cols-2">
								<TextSetting
									form={form}
									settingKey="telemetryEndpoint"
									label="Address"
									placeholder="http://localhost:4318"
									description="Where your tool takes OpenTelemetry data, for example http://localhost:4318."
									mono
								/>
								<SelectSetting
									form={form}
									settingKey="telemetryProtocol"
									label="Format"
									description="Use protobuf unless your tool asks for JSON."
									options={FORMATS}
								/>
							</div>
							<SaveError error={form.saveError} />
						</FieldGroup>
					</CardContent>
				</CardForm>
			</Card>
			<HeadersCard />
		</PageSection>
	);
}

/** The headers sent with the data: written once, then shown by name only. */
function HeadersCard() {
	const id = useId();
	const queryClient = useQueryClient();
	const headers = useQuery(settingsQueries.telemetryHeaders());
	const [draft, setDraft] = useState("");
	const save = useMutation(
		settingsMutations.saveTelemetryHeaders({
			onSuccess: (data) => {
				queryClient.setQueryData(
					settingsQueries.telemetryHeaders().queryKey,
					data,
				);
				setDraft("");
			},
		}),
	);
	const names = headers.data?.names ?? [];

	return (
		<Card>
			<form
				className="contents"
				noValidate
				onSubmit={(event) => {
					event.preventDefault();
					if (draft.trim() === "" || save.isPending) return;
					save.mutate(
						{ headers: draft },
						{ onSuccess: () => toast.success("Headers saved") },
					);
				}}
			>
				<CardContent>
					<FieldGroup>
						<Field data-invalid={save.error ? true : undefined}>
							<FieldLabel htmlFor={`${id}-headers`}>Headers</FieldLabel>
							<Textarea
								id={`${id}-headers`}
								value={draft}
								onChange={(event) => {
									save.reset();
									setDraft(event.target.value);
								}}
								placeholder="Authorization=Bearer abc123"
								className="font-mono"
								autoComplete="off"
								spellCheck={false}
								aria-invalid={save.error ? true : undefined}
								aria-describedby={`${id}-headers-description`}
							/>
							{save.error ? (
								<FieldError>{save.error.message}</FieldError>
							) : null}
							<FieldDescription id={`${id}-headers-description`}>
								Add the API key or other headers your tool needs, one per line.
								Night Shift keeps them like a secret and does not show them
								again. Saving replaces the headers you saved before.
							</FieldDescription>
							<div className="flex min-h-6 flex-wrap items-center gap-2">
								{names.length > 0 ? (
									<>
										{names.map((name) => (
											<Badge
												key={name}
												variant="secondary"
												className="font-mono"
											>
												{name}
											</Badge>
										))}
										<Button
											type="button"
											variant="ghost"
											size="xs"
											disabled={save.isPending}
											onClick={() =>
												save.mutate(
													{ headers: null },
													{ onSuccess: () => toast.success("Headers removed") },
												)
											}
										>
											Remove headers
										</Button>
									</>
								) : (
									<Badge variant="outline" className="text-muted-foreground">
										No headers
									</Badge>
								)}
							</div>
						</Field>
						<div className="flex justify-end">
							<Button
								type="submit"
								disabled={draft.trim() === "" || save.isPending}
							>
								{save.isPending ? <Spinner data-icon="inline-start" /> : null}
								Save headers
							</Button>
						</div>
					</FieldGroup>
				</CardContent>
			</form>
		</Card>
	);
}
