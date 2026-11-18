/** "Make subflow from section": the plan that moves a Section into a flow of its own. */

export type {
	SubflowBlocker,
	SubflowChange,
	SubflowInputSource,
	SubflowOptions,
	SubflowPlan,
	SubflowReader,
} from "./plan";
export { planSubflowFromSection } from "./subflow";
