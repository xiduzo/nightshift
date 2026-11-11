import { type Flow, GATE_TITLE_MAX } from "@nightshift/flows";
import { TemplateField } from "../template-field";

/**
 * The short title of a Gate or an Ask: one line, the heading in the
 * inbox. Empty: the field goes, and the question's first paragraph is
 * the heading.
 */
export function GateTitleField({
	id,
	flow,
	nodeId,
	title,
	onChange,
}: {
	id: string;
	flow: Flow;
	nodeId: string;
	title: string | undefined;
	onChange: (title: string | undefined) => void;
}) {
	const value = title ?? "";
	const tooLong = value.trim().length > GATE_TITLE_MAX;
	return (
		<TemplateField
			id={id}
			label="Title"
			hint={`The heading in the inbox, at most ${GATE_TITLE_MAX} characters. Empty: the first paragraph of the question.`}
			flow={flow}
			nodeId={nodeId}
			value={value}
			multiline={false}
			invalid={tooLong}
			error={
				tooLong
					? `Use at most ${GATE_TITLE_MAX} characters. Put the details in the question.`
					: null
			}
			placeholder="Send the reply to the customer?"
			onChange={(text) => {
				const line = text.replace(/\s*\n\s*/g, " ");
				onChange(line.trim() === "" ? undefined : line);
			}}
		/>
	);
}
