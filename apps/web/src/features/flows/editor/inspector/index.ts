/**
 * The inspectors: of a node (one file per node type), of the flow, and of an
 * edge. Each sub-folder holds the fields about one thing.
 */

export { useCommandTools } from "./access";
export { FloatingInspector } from "./floating-inspector";
export { FlowInspector } from "./flow-inspector";
export { Field, InspectorSection, Note } from "./form";
export { NodeInspector } from "./node-inspector";
export { EdgeInspector } from "./outcomes";
export { PresetForm } from "./value";
