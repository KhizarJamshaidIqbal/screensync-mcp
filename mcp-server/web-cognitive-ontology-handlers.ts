// ScreenSync Cognitive Tool Handlers - Architectures 10.0-11.0 (pruning, critical periods, executive, identity, wisdom, dynamics)
// Extracted from web.ts (rule 2: single responsibility + file-size limit).

import type { Response } from "express";
import { globalAdolescentEngine } from "./cognitive-adolescent.js";
import { cognitiveStore } from "./cognitive-memory.js";
import { DRAFT_GRACE_DAYS, pruneVerdict, statusOf } from "./cognitive-skills.js";
import { globalDynamicsEngine } from "./cognitive-dynamics.js";
import { globalSpine } from "./cognitive-spine.js";
import { hubWisdomInputs, spineAgeYears } from "./cognitive-spine-views.js";

export function handleOntologyCognitiveTool(tool: string, args: Record<string, any>, res: Response): boolean {
      if (tool === "web_synaptic_pruning") {
        try {
          const domain = cognitiveStore.normalizeDomain(String(args.domain || ""));
          if (!domain) {
            res.json({ success: true, ok: false, data: { error: "domain is required (pruning judges one domain's playbooks)." } });
            return true;
          }
          // The playbooks are the ones actually STORED for this domain, not a list the caller made up.
          // A caller could previously "prune" any ids it invented, and the result changed nothing real.
          const live = Object.values(cognitiveStore.load().playbooks).filter((p) => cognitiveStore.normalizeDomain(p.domain) === domain && statusOf(p) !== "deprecated");
          const argsIgnored = Array.isArray(args.playbooks) && args.playbooks.length > 0 ? ["playbooks"] : [];

          // The verdict is judged from what the store knows (cognitive-skills.ts): an unproven draft left
          // alone for a month is abandoned; a verified playbook is never pruned. Judging is pure, so a dry
          // run really does leave everything alone - it used to raise identityCoherence on every call.
          const now = Date.now();
          const verdicts = live.map((p) => ({ id: p.id, verdict: pruneVerdict(p, now) }));
          const pruned = verdicts.filter((v) => v.verdict === "prune").map((v) => v.id);
          const myelinated = verdicts.filter((v) => v.verdict === "myelinate").map((v) => v.id);
          const apply = args.apply === true;

          // Archiving marks a playbook deprecated: kept in the store, never deleted, never offered again.
          const archived = apply ? cognitiveStore.archivePlaybooks(domain, pruned, `synaptic pruning: unproven draft unused for over ${DRAFT_GRACE_DAYS} days`) : [];
          // Only what was really archived counts toward identity. An archived playbook cannot be archived
          // twice, so repeating the call cannot inflate the number.
          if (archived.length > 0) globalAdolescentEngine.recordPruning(domain, archived, []);
          res.json({
            success: true, ok: true,
            data: {
              domain, pruned, myelinated, archived,
              pruningIntensity: live.length ? pruned.length / live.length : 0,
              applied: apply,
              rule: `Only an unproven draft left unused for more than ${DRAFT_GRACE_DAYS} days is pruned. A verified playbook never is, and a draft with no dated activity is kept.`,
              ...(apply ? {} : { note: "Dry run: nothing was changed. Pass apply:true to archive the playbooks listed in `pruned` (they are marked deprecated and kept, never deleted)." }),
              ...(argsIgnored.length ? { argsIgnored } : {}),
            },
          });
        } catch (e: any) {
          res.json({ success: true, ok: false, data: { error: `Synaptic pruning failed: ${e.message}` } });
        }
        return true;
      }

      if (tool === "web_critical_period") {
        try {
          const cognitiveAgeYears = typeof args.cognitiveAgeYears === "number" ? args.cognitiveAgeYears : 0.5;
          const baseXp = typeof args.baseXp === "number" ? args.baseXp : 1;
          const result = globalAdolescentEngine.criticalPeriodBoost(cognitiveAgeYears, baseXp);
          res.json({ success: true, ok: true, data: result });
        } catch (e: any) {
          res.json({ success: true, ok: false, data: { error: `Critical period evaluation failed: ${e.message}` } });
        }
        return true;
      }

      if (tool === "web_working_memory_span") {
        try {
          const domain = String(args.domain || "").trim();
          const cognitiveAgeYears = typeof args.cognitiveAgeYears === "number" ? args.cognitiveAgeYears : domain ? spineAgeYears(domain) : 0.5;
          const result = globalAdolescentEngine.workingMemorySpan(domain, cognitiveAgeYears);
          res.json({ success: true, ok: true, data: result });
        } catch (e: any) {
          res.json({ success: true, ok: false, data: { error: `Working memory span failed: ${e.message}` } });
        }
        return true;
      }

      if (tool === "web_executive_function") {
        try {
          const domain = String(args.domain || "").trim();
          const telemetry = typeof args.telemetry === "object" && args.telemetry ? (args.telemetry as any) : {};
          const result = globalAdolescentEngine.executiveFunctionBattery(domain, telemetry);
          res.json({ success: true, ok: true, data: result });
        } catch (e: any) {
          res.json({ success: true, ok: false, data: { error: `Executive function battery failed: ${e.message}` } });
        }
        return true;
      }

      if (tool === "web_erikson_identity") {
        try {
          const domain = String(args.domain || "").trim();
          const cognitiveAgeYears = typeof args.cognitiveAgeYears === "number" ? args.cognitiveAgeYears : domain ? spineAgeYears(domain) : 0.5;
          const knowledgePieces = typeof args.knowledgePieces === "number" ? args.knowledgePieces : 0;
          const contradictions = typeof args.contradictions === "number" ? args.contradictions : 0;
          const result = globalAdolescentEngine.eriksonIdentity(domain, cognitiveAgeYears, knowledgePieces, contradictions);
          res.json({ success: true, ok: true, data: result });
        } catch (e: any) {
          res.json({ success: true, ok: false, data: { error: `Erikson identity evaluation failed: ${e.message}` } });
        }
        return true;
      }

      if (tool === "web_autonoetic_memory") {
        try {
          const domain = String(args.domain || "").trim();
          const episodeIds = Array.isArray(args.episodeIds) ? (args.episodeIds as string[]) : [];
          const recallSource = args.recallSource === "replay" ? "replay" : "semantic";
          const result = globalAdolescentEngine.autonoeticTag(domain, episodeIds, recallSource);
          res.json({ success: true, ok: true, data: result });
        } catch (e: any) {
          res.json({ success: true, ok: false, data: { error: `Autonoetic tagging failed: ${e.message}` } });
        }
        return true;
      }

      if (tool === "web_infant_error_signature") {
        try {
          const domain = String(args.domain || "").trim();
          const event = typeof args.event === "object" && args.event ? (args.event as any) : { errorOccurred: false };
          // The level is the hub's, never the caller's: a claimed earnedLevel is overwritten.
          const earnedLevel = domain ? globalSpine.earnedLevel(domain) : 1;
          const result = globalAdolescentEngine.infantErrorSignature(domain, { ...event, earnedLevel });
          res.json({ success: true, ok: true, data: result });
        } catch (e: any) {
          res.json({ success: true, ok: false, data: { error: `Infant error signature failed: ${e.message}` } });
        }
        return true;
      }

      if (tool === "web_wisdom_calibration") {
        try {
          const domain = String(args.domain || "").trim();
          let knowledgeDepth = typeof args.knowledgeDepth === "number" ? args.knowledgeDepth : 0.5;
          const statedConfidence = typeof args.statedConfidence === "number" ? args.statedConfidence : 0.5;
          let measuredAccuracy = typeof args.measuredAccuracy === "number" ? args.measuredAccuracy : 0.5;

          // With enough evidence the HUB measures depth and accuracy, so a caller cannot talk its way to
          // a high wisdom score. Only that hub-measured score is stored for the reflex gate to read.
          const held = domain ? hubWisdomInputs(domain) : null;
          const argsIgnored: string[] = [];
          if (held) {
            if (typeof args.knowledgeDepth === "number") argsIgnored.push("knowledgeDepth");
            if (typeof args.measuredAccuracy === "number") argsIgnored.push("measuredAccuracy");
            ({ knowledgeDepth, measuredAccuracy } = held);
          }
          const result = globalAdolescentEngine.wisdomCalibration(domain, knowledgeDepth, statedConfidence, measuredAccuracy);
          if (held) globalSpine.setWisdom(domain, result.wisdomScore);
          res.json({
            success: true, ok: true,
            data: { ...result, source: held ? "spine" : "caller", stored: held !== null, ...(argsIgnored.length ? { argsIgnored } : {}) },
          });
        } catch (e: any) {
          res.json({ success: true, ok: false, data: { error: `Wisdom calibration failed: ${e.message}` } });
        }
        return true;
      }

      if (tool === "web_assimilation_accommodation") {
        try {
          const domain = String(args.domain || "").trim();
          const observation = typeof args.observation === "object" && args.observation ? (args.observation as any) : { matchesExistingSchema: false };
          const result = globalDynamicsEngine.assimilateOrAccommodate(domain, observation);
          res.json({ success: true, ok: true, data: result });
        } catch (e: any) {
          res.json({ success: true, ok: false, data: { error: `Assimilation/accommodation failed: ${e.message}` } });
        }
        return true;
      }

      if (tool === "web_forgetting_curve") {
        try {
          const domain = String(args.domain || "").trim();
          const items = Array.isArray(args.items) ? (args.items as any) : [];
          const result = globalDynamicsEngine.forgettingCurve(domain, items);
          res.json({ success: true, ok: true, data: result });
        } catch (e: any) {
          res.json({ success: true, ok: false, data: { error: `Forgetting curve failed: ${e.message}` } });
        }
        return true;
      }

      if (tool === "web_reinforcement_schedule") {
        try {
          const domain = String(args.domain || "").trim();
          const context = {
            successStreak: typeof args.successStreak === "number" ? args.successStreak : 0,
            totalAttempts: typeof args.totalAttempts === "number" ? args.totalAttempts : 0,
            hoursSinceLastPractice: typeof args.hoursSinceLastPractice === "number" ? args.hoursSinceLastPractice : undefined,
          };
          const result = globalDynamicsEngine.reinforcementSchedule(domain, context);
          res.json({ success: true, ok: true, data: result });
        } catch (e: any) {
          res.json({ success: true, ok: false, data: { error: `Reinforcement schedule failed: ${e.message}` } });
        }
        return true;
      }

      if (tool === "web_prospective_memory") {
        try {
          const domain = String(args.domain || "").trim();
          const action = args.action === "register" ? "register" : "check";
          const intention = typeof args.intention === "object" && args.intention ? (args.intention as any) : undefined;
          const observedEvent = typeof args.observedEvent === "string" ? args.observedEvent : undefined;
          const result = globalDynamicsEngine.prospectiveMemory({ domain, action, intention, observedEvent });
          res.json({ success: true, ok: true, data: result });
        } catch (e: any) {
          res.json({ success: true, ok: false, data: { error: `Prospective memory failed: ${e.message}` } });
        }
        return true;
      }

      if (tool === "web_source_monitoring") {
        try {
          const domain = String(args.domain || "").trim();
          const facts = Array.isArray(args.facts) ? (args.facts as any) : [];
          const result = globalDynamicsEngine.sourceMonitoring(domain, facts);
          res.json({ success: true, ok: true, data: result });
        } catch (e: any) {
          res.json({ success: true, ok: false, data: { error: `Source monitoring failed: ${e.message}` } });
        }
        return true;
      }

      if (tool === "web_interference_check") {
        try {
          const domain = String(args.domain || "").trim();
          const others = Array.isArray(args.others) ? (args.others as any) : [];
          const result = globalDynamicsEngine.interferenceCheck(domain, others);
          res.json({ success: true, ok: true, data: result });
        } catch (e: any) {
          res.json({ success: true, ok: false, data: { error: `Interference check failed: ${e.message}` } });
        }
        return true;
      }

      if (tool === "web_reward_prediction_error") {
        try {
          const domain = String(args.domain || "").trim();
          const expectedReward = typeof args.expectedReward === "number" ? args.expectedReward : 0.5;
          const actualReward = typeof args.actualReward === "number" ? args.actualReward : 0.5;
          const result = globalDynamicsEngine.rewardPredictionError(domain, { expectedReward, actualReward });
          res.json({ success: true, ok: true, data: result });
        } catch (e: any) {
          res.json({ success: true, ok: false, data: { error: `Reward prediction error failed: ${e.message}` } });
        }
        return true;
      }

      if (tool === "web_cognitive_load_budget") {
        try {
          const domain = String(args.domain || "").trim();
          const load = {
            intrinsic: typeof args.intrinsic === "number" ? args.intrinsic : 1,
            extraneous: typeof args.extraneous === "number" ? args.extraneous : 0,
            germane: typeof args.germane === "number" ? args.germane : 0,
            capacityChunks: typeof args.capacityChunks === "number" ? args.capacityChunks : undefined,
          };
          const result = globalDynamicsEngine.cognitiveLoadBudget(domain, load);
          res.json({ success: true, ok: true, data: result });
        } catch (e: any) {
          res.json({ success: true, ok: false, data: { error: `Cognitive load budget failed: ${e.message}` } });
        }
        return true;
      }
  return false;
}
