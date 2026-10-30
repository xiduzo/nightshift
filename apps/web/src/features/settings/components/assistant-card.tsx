import { Card, CardContent } from "@nightshift/ui/components/card";
import { FieldGroup } from "@nightshift/ui/components/field";
import { useQuery } from "@tanstack/react-query";
import { profileQueries } from "@/features/agents";
import type { SettingsView } from "@/shared/api";
import { PageSection } from "@/shared/page";
import { useSettingsForm } from "../hooks/use-settings-form";
import {
	CardForm,
	ResetSection,
	SaveError,
	SelectSetting,
} from "./setting-fields";

const ASSISTANT_KEYS = ["assistantProfile"] as const;

/** Any profile: the first one whose harness is on this computer. */
const ANY = { value: "", label: "The first profile that works" };

export function AssistantCard({ data }: { data: SettingsView }) {
	const form = useSettingsForm(data, ASSISTANT_KEYS, {
		title: "Help in the flow editor",
	});
	const profiles = useQuery(profileQueries.agents());
	const saved = data.values.assistantProfile;
	const names = (profiles.data ?? []).map((profile) => profile.name);
	// A saved profile that is gone stays in the list, so the field shows it.
	if (saved && !names.includes(saved)) names.push(saved);
	const options = [ANY, ...names.map((name) => ({ value: name, label: name }))];

	return (
		<PageSection
			title="Help in the flow editor"
			description="An agent suggests prompts, outputs and variables, and edits the flow with you in a chat."
			actions={<ResetSection form={form} />}
		>
			<Card>
				<CardForm form={form}>
					<CardContent>
						<FieldGroup>
							<SelectSetting
								form={form}
								settingKey="assistantProfile"
								label="Profile"
								options={options}
							/>
							<SaveError error={form.saveError} />
						</FieldGroup>
					</CardContent>
				</CardForm>
			</Card>
		</PageSection>
	);
}
