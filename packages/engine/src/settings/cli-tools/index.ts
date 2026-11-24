/** This computer's CLI tools: programs its agents may run, in its Device document. `wireCliTools` binds the use cases behind the store the readers use. */

export {
	type CliTool,
	type CliToolInput,
	cliToolGitSchema,
	cliToolInputSchema,
	programOf,
} from "./domain/cli-tool";
export { type CliToolStore, wireCliTools } from "./wire";
