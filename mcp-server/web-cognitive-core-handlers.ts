// ScreenSync Cognitive Tool Handlers - Architectures 1.0-7.0 (memory, warm, contracts, lineage, metacognition, RPD)
// Extracted from web.ts (rule 2: single responsibility + file-size limit).

import type { Response } from "express";
import { cognitiveStore } from "./cognitive-memory.js";
import { globalAssociativeGraph } from "./cognitive-graph.js";
import { globalContractEngine } from "./cognitive-contracts.js";
import { globalLineageEngine } from "./cognitive-lineage.js";
import { globalMetacognitiveEngine } from "./cognitive-metacognition.js";
import { globalSimilarityEngine } from "./cognitive-similarity.js";
import { globalFederatedCatalog } from "./cognitive-federation.js";
import { globalSpine } from "./cognitive-spine.js";
import { globalObserver } from "./cognitive-spine-observer.js";
import { competenceOf, syncViews, HUB_SESSION, type CognitiveContext } from "./cognitive-spine-views.js";
import { globalReplayAndHygieneEngine } from "./cognitive-replay.js";
import { globalRpdEngine } from "./cognitive-rpd.js";

export function handleCoreCognitiveTool(tool: string, args: Record<string, any>, res: Response, ctx: CognitiveContext = { session: HUB_SESSION }): boolean {
      if (tool === "web_recall") {
        try {
          const resData = cognitiveStore.recall({
            domain: args.domain ? String(args.domain) : undefined,
            url: args.url ? String(args.url) : undefined,
            intent: args.intent ? String(args.intent) : undefined,
            profile: args.profile ? String(args.profile) : undefined,
          });
          res.json({ success: true, ok: true, data: resData });
        } catch (e: any) {
          res.json({ success: true, ok: false, data: { error: `Recall failed: ${e.message}` } });
        }
        return true;
      }

      if (tool === "web_learn") {
        try {
          const action = String(args.action || "").toLowerCase() as "playbook" | "pitfall" | "fact" | "episode" | "outcome";
          const domain = String(args.domain || "").trim();
          if (!domain) {
            res.status(400).json({ success: false, ok: false, error: "web_learn requires domain" });
            return true;
          }
          const learnData = (args.data && typeof args.data === "object" ? args.data : {}) as Record<string, any>;

          // A playbook run reported by the agent. It counts only if the HUB saw a verified success (an
          // action followed by a passing assertion) on this domain in this session: an agent saying so
          // proves nothing, and each sighting backs exactly one report.
          if (action === "outcome") {
            const key = String(learnData.playbook ?? learnData.playbookId ?? learnData.name ?? "").trim();
            if (!key) {
              res.json({ success: true, ok: false, data: { error: "web_learn outcome needs data.playbook (an id or a name)." } });
              return true;
            }
            if (!cognitiveStore.findPlaybook(domain, key)) {
              res.json({ success: true, ok: false, data: { error: `no playbook "${key}" is stored for ${domain}. Save it first with web_learn {action:'playbook'}.` } });
              return true;
            }
            const success = learnData.success !== false;
            const hubConfirmed = success && globalObserver.claimVerifiedCredit(ctx.session, domain);
            res.json({ success: true, ok: true, data: cognitiveStore.recordOutcome({ domain, playbook: key, success, session: ctx.session, hubConfirmed }) });
            return true;
          }

          const learned = cognitiveStore.learn({
            action,
            domain,
            intent: args.intent ? String(args.intent) : undefined,
            data: learnData,
          });
          res.json({ success: true, ok: true, data: learned });
        } catch (e: any) {
          res.json({ success: true, ok: false, data: { error: `Learn failed: ${e.message}` } });
        }
        return true;
      }

      if (tool === "web_warm") {
        try {
          const domain = String(args.domain || "").trim();
          const intent = String(args.intent || "").trim();
          if (!domain || !intent) {
            res.status(400).json({ success: false, ok: false, error: "web_warm requires domain and intent" });
            return true;
          }
          const warmed = cognitiveStore.warm({
            domain,
            intent,
            profile: args.profile ? String(args.profile) : undefined,
            detectedSignals: (args.detectedSignals && typeof args.detectedSignals === "object") ? (args.detectedSignals as Record<string, boolean>) : undefined,
          });
          res.json({ success: true, ok: true, data: warmed });
        } catch (e: any) {
          res.json({ success: true, ok: false, data: { error: `Warming failed: ${e.message}` } });
        }
        return true;
      }

      if (tool === "web_consolidate") {
        try {
          const report = cognitiveStore.consolidate();
          res.json({ success: true, ok: true, data: report });
        } catch (e: any) {
          res.json({ success: true, ok: false, data: { error: `Consolidation failed: ${e.message}` } });
        }
        return true;
      }

      if (tool === "web_graph_query") {
        try {
          const domain = String(args.domain || "").trim();
          const intent = String(args.intent || "").trim();
          const transferSkill = args.transferSkill === true;
          if (transferSkill && domain) {
            const transferRes = globalAssociativeGraph.transferSkill(domain, intent || "general", cognitiveStore);
            res.json({ success: true, ok: true, data: transferRes });
            return true;
          }
          res.json({
            success: true,
            ok: true,
            data: {
              nodesCount: globalAssociativeGraph.getNodes().length,
              edgesCount: globalAssociativeGraph.getEdges().length,
              nodes: globalAssociativeGraph.getNodes(),
              edges: globalAssociativeGraph.getEdges(),
            }
          });
        } catch (e: any) {
          res.json({ success: true, ok: false, data: { error: `Graph query failed: ${e.message}` } });
        }
        return true;
      }

      if (tool === "web_contract_check") {
        try {
          const domain = String(args.domain || "").trim();
          const url = String(args.url || `https://${domain}`);
          const allowDirtyNavigation = args.allowDirtyNavigation === true;
          const detectedDirtyFields = Array.isArray(args.detectedDirtyFields) ? args.detectedDirtyFields : [];
          const contractRes = globalContractEngine.evaluateFormContract({
            domain,
            url,
            detectedDirtyFields,
            allowDirtyNavigation,
          });
          res.json({ success: true, ok: true, data: contractRes });
        } catch (e: any) {
          res.json({ success: true, ok: false, data: { error: `Contract check failed: ${e.message}` } });
        }
        return true;
      }

      if (tool === "web_lineage") {
        try {
          const playbookId = args.playbookId ? String(args.playbookId).trim() : undefined;
          const history = globalLineageEngine.getHistory(playbookId);
          res.json({ success: true, ok: true, data: { totalCommits: history.length, commits: history } });
        } catch (e: any) {
          res.json({ success: true, ok: false, data: { error: `Lineage query failed: ${e.message}` } });
        }
        return true;
      }

      if (tool === "web_metacognition") {
        try {
          const domain = String(args.domain || "").trim();
          const intent = args.intent ? String(args.intent).trim() : "general";
          const currentLatencyMs = typeof args.currentLatencyMs === "number" ? args.currentLatencyMs : undefined;
          const evaluation = globalMetacognitiveEngine.evaluateConfidence({
            domain,
            intent,
            currentLatencyMs,
          });
          res.json({ success: true, ok: true, data: evaluation });
        } catch (e: any) {
          res.json({ success: true, ok: false, data: { error: `Metacognition evaluation failed: ${e.message}` } });
        }
        return true;
      }

      if (tool === "web_similarity_search") {
        try {
          const intent = args.intent ? String(args.intent).trim() : undefined;
          const targetElementDescription = args.targetElementDescription ? String(args.targetElementDescription).trim() : undefined;
          const candidates = Array.isArray(args.candidates) ? args.candidates : [];

          const out: Record<string, any> = {};
          if (intent) {
            out.intentMatch = globalSimilarityEngine.resolveIntent(intent);
          }
          if (targetElementDescription && candidates.length > 0) {
            out.elementMatch = globalSimilarityEngine.matchCandidateElement(targetElementDescription, candidates);
          }
          res.json({ success: true, ok: true, data: out });
        } catch (e: any) {
          res.json({ success: true, ok: false, data: { error: `Similarity search failed: ${e.message}` } });
        }
        return true;
      }

      if (tool === "web_federated_catalog") {
        try {
          const action = String(args.action || "list_shared").toLowerCase();
          const domain = args.domain ? String(args.domain).trim() : undefined;
          const intent = args.intent ? String(args.intent).trim() : undefined;
          const profile = args.profile ? String(args.profile).trim() : "epsoldev@gmail.com";

          if (action === "publish") {
            const recipe = (args.recipe && typeof args.recipe === "object") ? args.recipe : {};
            const published = globalFederatedCatalog.publishSharedRecipe({
              originProfile: profile,
              domain: domain || "shared",
              intent: intent || "workflow",
              recipe,
            });
            res.json({ success: true, ok: true, data: published });
            return true;
          }

          if (action === "link_profile") {
            const linked = globalFederatedCatalog.linkProfile(profile);
            res.json({ success: true, ok: true, data: linked });
            return true;
          }

          // Default: list_shared
          const recipes = globalFederatedCatalog.querySharedRecipes(domain, intent);
          res.json({
            success: true,
            ok: true,
            data: {
              totalRecipes: recipes.length,
              recipes,
              linkedProfiles: globalFederatedCatalog.getLinkedProfiles(),
            },
          });
        } catch (e: any) {
          res.json({ success: true, ok: false, data: { error: `Federated catalog query failed: ${e.message}` } });
        }
        return true;
      }

      if (tool === "web_cognitive_stage") {
        try {
          const domain = String(args.domain || "").trim();
          if (!domain) {
            res.json({ success: true, ok: false, data: { error: "domain is required (a stage is tracked per domain)." } });
            return true;
          }
          const action = String(args.action || "get").toLowerCase();
          const stage = typeof args.stage === "number" ? args.stage : undefined;

          // 'override' used to let ANY caller force a domain to stage 5. It is now an audited human vouch:
          // capped at COMPETENT, shown as source:"vouched", and never counted as earned evidence.
          let vouchApplied: Record<string, unknown> | undefined;
          if (action === "override" && stage !== undefined) {
            const entry = globalSpine.vouch(domain, stage, String(args.reason || "manual override via web_cognitive_stage"), ctx.session);
            vouchApplied = {
              requestedStage: entry.requested, appliedLevel: entry.level, cappedAtCompetent: entry.requested > entry.level,
              note: "A vouch changes the advisory view only. It is audited and never counts as earned evidence.",
            };
          }

          const views = syncViews(domain);
          const next = views.evaluation.next;
          res.json({
            success: true, ok: true,
            data: {
              ...views.development,
              competence: competenceOf(views.evaluation),
              ...(action === "evaluate" ? { evaluated: true, promotable: next !== null && next.needs.length === 0 } : {}),
              ...(vouchApplied ? { vouchApplied } : {}),
            },
          });
        } catch (e: any) {
          res.json({ success: true, ok: false, data: { error: `Cognitive stage query failed: ${e.message}` } });
        }
        return true;
      }

      if (tool === "web_cognitive_replay") {
        try {
          const domain = String(args.domain || "").trim();
          const playbookId = typeof args.playbookId === "string" ? args.playbookId : undefined;
          const autoSynthesizeBranch = Boolean(args.autoSynthesizeBranch);
          const counterfactualScenarios = Array.isArray(args.counterfactualScenarios) ? (args.counterfactualScenarios as any) : undefined;
          const result = globalReplayAndHygieneEngine.simulateOfflineReplay({
            domain,
            playbookId,
            autoSynthesizeBranch,
            counterfactualScenarios,
          });
          res.json({ success: true, ok: true, data: result });
        } catch (e: any) {
          res.json({ success: true, ok: false, data: { error: `Replay simulation failed: ${e.message}` } });
        }
        return true;
      }

      if (tool === "web_episodic_query") {
        try {
          const domain = typeof args.domain === "string" ? args.domain.trim() : undefined;
          const intent = typeof args.intent === "string" ? args.intent.trim() : undefined;
          const outcome = args.outcome === "success" || args.outcome === "failure" ? args.outcome : undefined;
          const limit = typeof args.limit === "number" ? args.limit : undefined;
          const result = globalReplayAndHygieneEngine.queryEpisodicMemory({ domain, intent, outcome, limit });
          res.json({ success: true, ok: true, data: result });
        } catch (e: any) {
          res.json({ success: true, ok: false, data: { error: `Episodic query failed: ${e.message}` } });
        }
        return true;
      }

      if (tool === "web_cognitive_hygiene") {
        try {
          const domain = String(args.domain || "").trim();
          const action = String(args.action || "profile").toLowerCase();
          if (action === "autoclean") {
            const cleaned = globalReplayAndHygieneEngine.runAutocleaning(domain);
            res.json({ success: true, ok: true, data: cleaned });
            return true;
          }
          const profile = globalReplayAndHygieneEngine.profileHygiene(domain);
          res.json({ success: true, ok: true, data: profile });
        } catch (e: any) {
          res.json({ success: true, ok: false, data: { error: `Cognitive hygiene failed: ${e.message}` } });
        }
        return true;
      }

      if (tool === "web_object_permanence") {
        try {
          const domain = String(args.domain || "").trim();
          const selector = String(args.selector || "").trim();
          const action = String(args.action || "resolve").toLowerCase();
          if (action === "register" && args.rect) {
            globalRpdEngine.registerSpatialLocation(domain, {
              selector,
              lastSeenRect: args.rect as any,
              scrollOffsetWhenSeen: { x: 0, y: 0 },
              observedAt: new Date().toISOString(),
            });
            res.json({ success: true, ok: true, data: { registered: true, domain, selector } });
            return true;
          }
          const currentViewport = (args.currentViewport as any) || { width: 1280, height: 800, scrollX: 0, scrollY: 0 };
          const resolved = globalRpdEngine.resolveOffscreenElement(domain, selector, currentViewport);
          res.json({ success: true, ok: true, data: resolved });
        } catch (e: any) {
          res.json({ success: true, ok: false, data: { error: `Object permanence failed: ${e.message}` } });
        }
        return true;
      }

      if (tool === "web_theory_of_mind") {
        try {
          const domain = String(args.domain || "").trim();
          const actionCount = typeof args.actionCountInLastMinute === "number" ? args.actionCountInLastMinute : 12;
          const hasCaptcha = Boolean(args.hasCaptchaOrWafDetected);
          const assessment = globalRpdEngine.evaluateTheoryOfMind({
            domain,
            actionCountInLastMinute: actionCount,
            hasCaptchaOrWafDetected: hasCaptcha,
          });
          res.json({ success: true, ok: true, data: assessment });
        } catch (e: any) {
          res.json({ success: true, ok: false, data: { error: `Theory of mind failed: ${e.message}` } });
        }
        return true;
      }

      if (tool === "web_cognitive_undo") {
        try {
          const targetTool = String(args.targetTool || "").trim();
          const targetSelector = typeof args.targetSelector === "string" ? args.targetSelector : undefined;
          const toolArgs = typeof args.args === "object" && args.args ? (args.args as Record<string, unknown>) : undefined;
          const assessment = globalRpdEngine.assessReversibility({
            tool: targetTool,
            targetSelector,
            args: toolArgs,
          });
          res.json({ success: true, ok: true, data: assessment });
        } catch (e: any) {
          res.json({ success: true, ok: false, data: { error: `Cognitive undo assessment failed: ${e.message}` } });
        }
        return true;
      }

      if (tool === "web_rpd_prototype") {
        try {
          const url = String(args.url || "").trim();
          const domSignature = typeof args.domSignature === "object" && args.domSignature ? (args.domSignature as any) : undefined;
          const strategy = globalRpdEngine.classifyPageArchetype({ url, domSignature });
          res.json({ success: true, ok: true, data: strategy });
        } catch (e: any) {
          res.json({ success: true, ok: false, data: { error: `RPD archetype classification failed: ${e.message}` } });
        }
        return true;
      }

  return false;
}
