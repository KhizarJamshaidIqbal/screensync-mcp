// ScreenSync Cognitive Tool Handler Dispatcher (Architectures 1.0 - 12.0)
// web.ts delegates here; each architecture band lives in its own module.

import type { Response } from "express";
import { handleCoreCognitiveTool } from "./web-cognitive-core-handlers.js";
import { handleEvolutionCognitiveTool } from "./web-cognitive-evolution-handlers.js";
import { handleOntologyCognitiveTool } from "./web-cognitive-ontology-handlers.js";
import { handleTranscendentalCognitiveTool } from "./web-cognitive-transcendental-handlers.js";
import { HUB_SESSION, type CognitiveContext } from "./cognitive-spine-views.js";
import { canonicalDomain } from "./cognitive-domain.js";

/**
 * Every handler reads args.domain, and several used it raw: "https://WWW.x.com:443/" asked for a domain no
 * store had ever heard of. It is canonicalized once, here, so no handler can forget. A string that does not
 * parse as a host is passed through untouched, so each handler keeps its own error for it. The caller's
 * object is never mutated.
 */
function withCanonicalDomain(args: Record<string, any>): Record<string, any> {
  if (typeof args?.domain !== "string") return args;
  const canonical = canonicalDomain(args.domain);
  return canonical && canonical !== args.domain ? { ...args, domain: canonical } : args;
}

/**
 * Handles every cognitive/developmental tool call on the web bridge.
 * Returns true when the tool was handled (a response has been sent).
 */
export function handleCognitiveTool(tool: string, rawArgs: Record<string, any>, res: Response, ctx: CognitiveContext = { session: HUB_SESSION }): boolean {
  const args = withCanonicalDomain(rawArgs);
  if (handleCoreCognitiveTool(tool, args, res, ctx)) return true;
  if (handleEvolutionCognitiveTool(tool, args, res, ctx)) return true;
  if (handleOntologyCognitiveTool(tool, args, res)) return true;
  return handleTranscendentalCognitiveTool(tool, args, res);
}
