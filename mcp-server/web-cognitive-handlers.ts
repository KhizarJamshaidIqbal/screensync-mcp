// ScreenSync Cognitive Tool Handler Dispatcher (Architectures 1.0 - 12.0)
// web.ts delegates here; each architecture band lives in its own module.

import type { Response } from "express";
import { handleCoreCognitiveTool } from "./web-cognitive-core-handlers.js";
import { handleEvolutionCognitiveTool } from "./web-cognitive-evolution-handlers.js";
import { handleOntologyCognitiveTool } from "./web-cognitive-ontology-handlers.js";
import { handleTranscendentalCognitiveTool } from "./web-cognitive-transcendental-handlers.js";
import { HUB_SESSION, type CognitiveContext } from "./cognitive-spine-views.js";

/**
 * Handles every cognitive/developmental tool call on the web bridge.
 * Returns true when the tool was handled (a response has been sent).
 */
export function handleCognitiveTool(tool: string, args: Record<string, any>, res: Response, ctx: CognitiveContext = { session: HUB_SESSION }): boolean {
  if (handleCoreCognitiveTool(tool, args, res, ctx)) return true;
  if (handleEvolutionCognitiveTool(tool, args, res, ctx)) return true;
  if (handleOntologyCognitiveTool(tool, args, res)) return true;
  return handleTranscendentalCognitiveTool(tool, args, res);
}
