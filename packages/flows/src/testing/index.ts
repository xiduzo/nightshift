/**
 * Test helpers of `@nightshift/flows`: a Command node with the id and the
 * position a test chooses (`commandNode`), a flow as a test writes it,
 * before the schema fills in its defaults (`FlowInput`), and the command of
 * a kit's node as a step renders it (`kitCommand`). Only tests import this
 * entry.
 */
export { commandNode } from "../draft/nodes";
export type { FlowInput } from "../flow";
export { kitCommand } from "./kit-command";
