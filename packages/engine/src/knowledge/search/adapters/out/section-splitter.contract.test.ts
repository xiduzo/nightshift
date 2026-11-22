import { inMemorySectionSplitter } from "./in-memory-section-splitter";
import { langchainSectionSplitter } from "./langchain-section-splitter";
import { sectionSplitterContract } from "./section-splitter.contract";

/** The contract of `SectionSplitter`, on both adapters. */

sectionSplitterContract("in memory", inMemorySectionSplitter);

sectionSplitterContract("over langchain", langchainSectionSplitter);
