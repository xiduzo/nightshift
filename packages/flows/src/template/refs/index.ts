/** Templates: the `{{name.path}}` references of a text, what they read, how they render, and where a shell leaves them as they are. */

export {
	type NodeOutputs,
	type RunField,
	runFields,
	type TemplateContext,
	type TemplateRef,
} from "./context";
export { templatesInLiteralShellText } from "./shell-quotes";
export {
	isOnlyRef,
	lookupRef,
	renderCommand,
	renderGateQuestion,
	renderReadable,
	renderTemplate,
	renderValue,
	TEMPLATE_REF,
	templateRefs,
} from "./template";
