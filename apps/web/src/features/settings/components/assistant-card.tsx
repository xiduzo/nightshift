import { Card, CardContent } from "@nightshift/ui/components/card";
import { FieldGroup } from "@nightshift/ui/components/field";
import { useQuery } from "@tanstack/react-query";
import { profileQueries } from "@/features/agents";
import type { SettingsView } from "@/shared/api";
import { PageSection } from "@/shared/page";
import { useSettingsForm } from "../hooks/use-settings-form";
import {
	CardForm,
	FormFooter,
	SaveError,
	SelectSetting,
} from "./setting-fields";

const ASSISTANT_KEYS = ["assistantProfile"] as const;

/** Any profile: the first one whose harness is on this computer. */
const ANY = { value: "", label: "The first profile that works" };

export function AssistantCard({ data }: { data: SettingsView }) {
	const form = useSettingsForm(data, ASSISTANT_KEYS);
	const profiles = useQuery(profileQueries.list());
	const saved = data.values.assistantProfile;
	const names = (profiles.data ?? []).map((profile) => profile.name);
	// A saved profile that is gone stays in the list, so the field shows it.
	if (saved && !names.includes(saved)) names.push(saved);
	const options = [ANY, ...names.map((name) => ({ value: name, label: name }))];

	return (
		<PageSection
			title="Suggestions"
			description="The flow editor can suggest a prompt, outputs or variables for a node."
		>
			<Card>
				<CardForm form={form}>
					<CardContent>
						<FieldGroup>
							<SelectSetting
								form={form}
								data={data}
								settingKey="assistantProfile"
								label="Profile for suggestions"
								description="Night Shift uses this profile when you ask it to suggest a prompt, outputs or variables."
								options={options}
							/>
							<SaveError error={form.saveError} />
						</FieldGroup>
					</CardContent>
					<FormFooter form={form} label="Save" />
				</CardForm>
			</Card>
		</PageSection>
	);
}
