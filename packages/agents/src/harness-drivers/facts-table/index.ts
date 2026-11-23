/**
 * The facts of each harness as pure data: one file per harness, and the
 * table that collects them. No file here imports adapter code or a `node:`
 * module, so the browser-safe `./harness-facts` entry (`../facts.ts`) reads
 * this barrel. The barrel of a harness folder brings its adapter, so the
 * facts of a harness do not live in its folder.
 */
export { ACP_DEFAULT_MODEL, ACP_FACTS, type AcpAgentName } from "./acp";
export { CLAUDE_CODE_FACTS } from "./claude-code";
export { CODEX_FACTS } from "./codex";
export { GROK_BUILD_FACTS } from "./grok-build";
export { OPENCODE_FACTS } from "./opencode";
export { HARNESS_FACTS } from "./table";
