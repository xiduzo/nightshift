/**
 * Test helpers of `@nightshift/flows`: a Command node with the id and the
 * position a test chooses (`commandNode`), and a flow as a test writes it,
 * before the schema fills in its defaults (`FlowInput`). Only tests import
 * this entry.
 */
export { commandNode } from "../draft/nodes";
export type { FlowInput } from "../flow";
