/** An Ask (ADR 10): the form of a Value made by a person, read from the node's output schema. */

export {
	ASK_ANSWER,
	type AskAttachment,
	type AskChoice,
	type AskField,
	type AskFieldKind,
	type AskForm,
	type AttachmentSource,
	askFields,
	askFormSchema,
	attachmentSourceSchema,
	type ChoiceItem,
	choiceItemSchema,
	choicesFieldProblem,
	formDataProblem,
	isSimpleForm,
	withChoices,
} from "./ask";
