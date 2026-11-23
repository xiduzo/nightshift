import { wireAssistant } from "./assistant";

const assistant = wireAssistant();

export const chatTurn = assistant.chatTurn;
export const checkAgent = assistant.checkAgent;
export const explainRun = assistant.explainRun;
export const learnFromRun = assistant.learnFromRun;
export const serveTools = assistant.serveTools;
export const terminalTools = assistant.terminalTools;
export const terminalResources = assistant.terminalResources;
export const suggestField = assistant.suggestField;
