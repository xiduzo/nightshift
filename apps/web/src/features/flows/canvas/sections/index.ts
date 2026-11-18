/**
 * Sections: boxes of nodes you zoom into, their edges to what lies outside,
 * and how their run went.
 */

export { sectionEnds } from "./folded-edges";
export { useOpenSection } from "./section-focus";
export { moveSection, sectionDragDelta } from "./section-geometry";
export { isOutsideId, sectionIdOf, sectionNodeId } from "./section-ids";
export {
	type CanvasNode,
	canvasNodeTypes,
	SectionActionsContext,
	type SectionBoxData,
} from "./section-nodes";
export { OpenSectionBar, SectionZoom } from "./section-zoom";
export { sectionIds, useSectionCanvas } from "./use-section-canvas";
