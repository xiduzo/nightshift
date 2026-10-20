import { Card, CardContent } from "@nightshift/ui/components/card";
import { FieldGroup } from "@nightshift/ui/components/field";
import { useQuery } from "@tanstack/react-query";
import { TriangleAlertIcon } from "lucide-react";
import {
	deciderQueries,
	HARNESSES,
	type HarnessName,
	harnessInfo,
} from "@/features/agents";
import type { SettingsView } from "@/shared/api";
import { PageSection } from "@/shared/page";
import { useSettingsForm } from "../hooks/use-settings-form";
import { PERMISSION_MODES } from "../permission-modes";
import {
	CardForm,
	FormFooter,
	SaveError,
	SelectSetting,
	TextSetting,
} from "./setting-fields";

const AGENT_KEYS = [
	"agentHarness",
	"agentModel",
	"agentPermissionMode",
	"decisionDecider",
] as const;

export function AgentDefaultsCard({ data }: { data: SettingsView }) {
	const form = useSettingsForm(data, AGENT_KEYS);
	const harness = harnessInfo(form.value("agentHarness") as HarnessName);
	const mode = PERMISSION_MODES.find(
		(option) => option.value === form.value("agentPermissionMode"),
	);
	const deciders = useQuery(deciderQueries.list());
	const deciderOptions = (deciders.data ?? []).map((d) => ({
		value: d.name,
		label: d.label,
	}));

	return (
		<PageSection
			title="New Agent nodes"
			description="What a new Agent or Decision node starts with in the flow editor. Nodes you already made keep their own values."
		>
			<Card>
				<CardForm form={form}>
					<CardContent>
						<FieldGroup>
							<div className="grid gap-6 sm:grid-cols-2">
								<SelectSetting
									form={form}
									data={data}
									settingKey="agentHarness"
									label="Harness"
									description={harness.note}
									options={HARNESSES}
									onPick={(next) => {
										// A model suggested for the old harness means nothing to the new one.
										const model = form.value("agentModel");
										if (harness.models.includes(model) || model.trim() === "") {
											form.set("agentModel", harnessInfo(next).defaultModel);
										}
									}}
								/>
								<TextSetting
									form={form}
									data={data}
									settingKey="agentModel"
									label="Model"
									description={`Any model ${harness.label} supports, for example ${harness.models.slice(0, 3).join(", ")}.`}
									mono
									suggestions={harness.models}
								/>
								<SelectSetting
									form={form}
									data={data}
									settingKey="agentPermissionMode"
									label="Permission mode"
									description={
										mode?.value === "bypassPermissions" ? (
											<span className="flex items-start gap-1.5 text-status-waiting">
												<TriangleAlertIcon
													className="mt-0.5 size-3.5 shrink-0"
													aria-hidden="true"
												/>
												{mode.description}
											</span>
										) : (
											mode?.description
										)
									}
									options={PERMISSION_MODES}
								/>
								<SelectSetting
									form={form}
									data={data}
									settingKey="decisionDecider"
									label="Decider"
									description="A new Decision node picks its label with this decision model."
									options={deciderOptions}
								/>
							</div>
							<SaveError error={form.saveError} />
						</FieldGroup>
					</CardContent>
					<FormFooter form={form} label="Save defaults" />
				</CardForm>
			</Card>
		</PageSection>
	);
}
