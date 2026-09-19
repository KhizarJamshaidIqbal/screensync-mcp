// ScreenSync Cognitive Tool Handlers - Architectures 8.0-9.0 (maturation, epistemic graph, curiosity, homeostasis, lifespan, GQL, babbling, metaphor)
// Extracted from web.ts (rule 2: single responsibility + file-size limit).

import type { Response } from "express";
import { globalMaturationEngine } from "./cognitive-maturation.js";
import { globalLifespanEngine } from "./cognitive-lifespan.js";

export function handleEvolutionCognitiveTool(tool: string, args: Record<string, any>, res: Response): boolean {
      if (tool === "web_cognitive_maturation") {
        try {
          const domain = String(args.domain || "").trim();
          const event = typeof args.event === "object" && args.event ? (args.event as any) : undefined;
          const profile = globalMaturationEngine.getOrEvolveProfile(domain, event);
          res.json({ success: true, ok: true, data: profile });
        } catch (e: any) {
          res.json({ success: true, ok: false, data: { error: `Cognitive maturation failed: ${e.message}` } });
        }
        return true;
      }

      if (tool === "web_epistemic_graph") {
        try {
          const action = String(args.action || "summary").toLowerCase();
          if (action === "add_node" && args.node) {
            const node = globalMaturationEngine.addNode(args.node as any);
            res.json({ success: true, ok: true, data: { addedNode: node } });
            return true;
          }
          if (action === "add_edge" && args.edge) {
            const edge = globalMaturationEngine.addEdge(args.edge as any);
            res.json({ success: true, ok: true, data: { addedEdge: edge } });
            return true;
          }
          if (action === "trace_lineage" && args.targetNodeId) {
            const lineage = globalMaturationEngine.traceLineage(String(args.targetNodeId));
            res.json({ success: true, ok: true, data: lineage });
            return true;
          }
          const stats = globalMaturationEngine.getGraphStats();
          res.json({ success: true, ok: true, data: stats });
        } catch (e: any) {
          res.json({ success: true, ok: false, data: { error: `Epistemic graph failed: ${e.message}` } });
        }
        return true;
      }

      if (tool === "web_curiosity_frontier") {
        try {
          const elements = Array.isArray(args.elements) ? (args.elements as any) : [];
          const evaluation = globalMaturationEngine.evaluateCuriosityFrontier(elements);
          res.json({ success: true, ok: true, data: evaluation });
        } catch (e: any) {
          res.json({ success: true, ok: false, data: { error: `Curiosity frontier evaluation failed: ${e.message}` } });
        }
        return true;
      }

      if (tool === "web_homeostatic_regulation") {
        try {
          const domNodeCount = typeof args.domNodeCount === "number" ? args.domNodeCount : 1200;
          const actionsPerMinute = typeof args.actionsPerMinute === "number" ? args.actionsPerMinute : 15;
          const recentErrorRate = typeof args.recentErrorRate === "number" ? args.recentErrorRate : 0.05;
          const averageLatencyMs = typeof args.averageLatencyMs === "number" ? args.averageLatencyMs : 450;
          const threatSuspicionScore = typeof args.threatSuspicionScore === "number" ? args.threatSuspicionScore : 0.1;
          const homeo = globalMaturationEngine.evaluateHomeostasis({
            domNodeCount,
            actionsPerMinute,
            recentErrorRate,
            averageLatencyMs,
            threatSuspicionScore,
          });
          res.json({ success: true, ok: true, data: homeo });
        } catch (e: any) {
          res.json({ success: true, ok: false, data: { error: `Homeostatic regulation failed: ${e.message}` } });
        }
        return true;
      }

      if (tool === "web_cognitive_lifespan") {
        try {
          const domain = String(args.domain || "").trim();
          const event = typeof args.event === "object" && args.event ? (args.event as any) : undefined;
          const lifespan = globalLifespanEngine.evaluateLifespan(domain, event);
          res.json({ success: true, ok: true, data: lifespan });
        } catch (e: any) {
          res.json({ success: true, ok: false, data: { error: `Cognitive lifespan evaluation failed: ${e.message}` } });
        }
        return true;
      }

      if (tool === "web_graph_pattern_match") {
        try {
          const startNodeId = String(args.startNodeId || "").trim();
          const nodes = Array.isArray(args.nodes) ? (args.nodes as any) : [];
          const edges = Array.isArray(args.edges) ? (args.edges as any) : [];
          const query = {
            startNodeId,
            targetNodeType: typeof args.targetNodeType === "string" ? args.targetNodeType : undefined,
            targetNodeId: typeof args.targetNodeId === "string" ? args.targetNodeId : undefined,
            relationshipTypes: Array.isArray(args.relationshipTypes) ? (args.relationshipTypes as string[]) : undefined,
            maxDepth: typeof args.maxDepth === "number" ? args.maxDepth : undefined,
          };
          const matchResult = globalLifespanEngine.matchGraphPattern(nodes, edges, query);
          res.json({ success: true, ok: true, data: matchResult });
        } catch (e: any) {
          res.json({ success: true, ok: false, data: { error: `Graph pattern match failed: ${e.message}` } });
        }
        return true;
      }

      if (tool === "web_motor_babbling") {
        try {
          const domain = String(args.domain || "").trim();
          const sampleLatencyMs = typeof args.sampleLatencyMs === "number" ? args.sampleLatencyMs : undefined;
          const devicePixelRatio = typeof args.devicePixelRatio === "number" ? args.devicePixelRatio : undefined;
          const targetElementType = typeof args.targetElementType === "string" ? (args.targetElementType as any) : undefined;
          const calibration = globalLifespanEngine.calibrateMotorBabbling({
            domain,
            sampleLatencyMs,
            devicePixelRatio,
            targetElementType,
          });
          res.json({ success: true, ok: true, data: calibration });
        } catch (e: any) {
          res.json({ success: true, ok: false, data: { error: `Motor babbling calibration failed: ${e.message}` } });
        }
        return true;
      }

      if (tool === "web_metaphoric_transfer") {
        try {
          const sourceDomain = String(args.sourceDomain || "").trim();
          const targetDomain = String(args.targetDomain || "").trim();
          const mapping = globalLifespanEngine.transferMetaphor(sourceDomain, targetDomain);
          res.json({ success: true, ok: true, data: mapping });
        } catch (e: any) {
          res.json({ success: true, ok: false, data: { error: `Metaphoric transfer failed: ${e.message}` } });
        }
        return true;
      }

  return false;
}
