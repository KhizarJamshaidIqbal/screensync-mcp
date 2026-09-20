// ScreenSync Cognitive Tool Handlers - Architecture 12.0 (sleep consolidation, reflex compilation,
// threat inoculation, ZPD tutoring, somatic markers, working memory, dialectics, wisdom capsules)
// Registered through web-cognitive-handlers.ts (rule 2: single responsibility + file-size limit).

import type { Response } from "express";
import { globalTranscendentalEngine } from "./cognitive-transcendental.js";
import { globalSpine } from "./cognitive-spine.js";
import { cognitiveStore } from "./cognitive-memory.js";
import { isFastPath, statusOf } from "./cognitive-skills.js";
import { HUB_SESSION } from "./cognitive-spine-views.js";

export function handleTranscendentalCognitiveTool(tool: string, args: Record<string, any>, res: Response): boolean {
  if (tool === "web_rem_dream_simulation") {
    try {
      const domain = String(args.domain || "").trim();
      const traces = Array.isArray(args.traces) ? (args.traces as any) : [];
      const cycles = typeof args.cycles === "number" ? args.cycles : 2;
      const result = globalTranscendentalEngine.remDreamSimulation(domain, traces, cycles);
      res.json({ success: true, ok: true, data: result });
    } catch (e: any) {
      res.json({ success: true, ok: false, data: { error: `REM dream simulation failed: ${e.message}` } });
    }
    return true;
  }

  if (tool === "web_system1_reflex_compile") {
    try {
      const domain = String(args.domain || "").trim();
      const playbook = typeof args.playbook === "object" && args.playbook ? (args.playbook as any) : { id: "", steps: [] };

      // The automatism gate used to read successCount and wisdomScore from the caller's own playbook, so
      // any caller could compile a reflex by typing 10 and 1.0. With a domain, both now come from the
      // spine (verified successes the hub observed; the wisdom score the hub stored) and the caller's
      // numbers are ignored. Without one there is nothing hub-held to consult, so it stays a calculator.
      let argsIgnored: string[] = [];
      let source: "spine" | "caller" = "caller";
      let effective = playbook;
      if (domain) {
        argsIgnored = ["successCount", "wisdomScore"].filter((k) => playbook[k] !== undefined).map((k) => `playbook.${k}`);
        effective = { ...playbook, successCount: globalSpine.evaluate(domain).evidence.verified, wisdomScore: globalSpine.wisdom(domain)?.score ?? 0 };
        source = "spine";
      }
      // A stored playbook must also be VERIFIED (cognitive-skills.ts) to become a reflex: a draft the model
      // has never had confirmed is never automated, however well the domain as a whole has been doing.
      const stored = domain && typeof playbook.id === "string" && playbook.id ? cognitiveStore.findPlaybook(domain, playbook.id) : null;
      const unverified = stored !== null && !isFastPath(stored);
      const result = globalTranscendentalEngine.system1ReflexCompile(domain, unverified ? { ...effective, successCount: 0 } : effective);
      const data = unverified
        ? { ...result, reason: `Playbook "${stored.name}" is ${statusOf(stored) === "verified" ? "on a run of reported failures" : `an unverified ${statusOf(stored)}`}: it must be verified (two hub-confirmed runs in two sessions) before it can become a reflex.` }
        : result;
      res.json({ success: true, ok: true, data: { ...data, source, ...(argsIgnored.length ? { argsIgnored } : {}) } });
    } catch (e: any) {
      res.json({ success: true, ok: false, data: { error: `Reflex compilation failed: ${e.message}` } });
    }
    return true;
  }

  if (tool === "web_amygdala_threat_inoculation") {
    try {
      const domain = String(args.domain || "").trim();
      // action:"state" is the read path for the extension dashboard. The breaker lives in
      // this process, so the panel has to ask the hub; it must never mutate what it reads.
      if (String(args.action || "") === "state") {
        const threats = globalTranscendentalEngine.threatState(domain || undefined);
        res.json({ success: true, ok: true, data: { threats, tracked: threats.length } });
        return true;
      }
      if (!domain) {
        res.json({ success: true, ok: false, data: { error: "domain is required to appraise a threat signal (use action:'state' to read the breaker)." } });
        return true;
      }
      const signal = typeof args.signal === "object" && args.signal ? (args.signal as any) : {};
      const result = globalTranscendentalEngine.amygdalaThreatInoculation(domain, signal);
      // A tripped breaker is the strongest failure the hub can see: it drops the domain a rung.
      if (result.breakerState === "TRIPPED") globalSpine.record(domain, "breaker", HUB_SESSION);
      res.json({ success: true, ok: true, data: result });
    } catch (e: any) {
      res.json({ success: true, ok: false, data: { error: `Threat inoculation failed: ${e.message}` } });
    }
    return true;
  }

  if (tool === "web_zpd_scaffold_tutor") {
    try {
      const pupil = String(args.pupilDomain || "").trim();
      const mentor = String(args.mentorDomain || "").trim();
      const stats = typeof args.stats === "object" && args.stats ? (args.stats as any) : {};
      const result = globalTranscendentalEngine.zpdScaffoldTutor(pupil, mentor, stats);
      res.json({ success: true, ok: true, data: result });
    } catch (e: any) {
      res.json({ success: true, ok: false, data: { error: `ZPD scaffolding failed: ${e.message}` } });
    }
    return true;
  }

  if (tool === "web_somatic_marker_risk") {
    try {
      const domain = String(args.domain || "").trim();
      const action = typeof args.action === "object" && args.action ? (args.action as any) : {};
      const result = globalTranscendentalEngine.somaticMarkerRisk(domain, action);
      res.json({ success: true, ok: true, data: result });
    } catch (e: any) {
      res.json({ success: true, ok: false, data: { error: `Somatic marker appraisal failed: ${e.message}` } });
    }
    return true;
  }

  if (tool === "web_baddeley_working_memory") {
    try {
      const domain = String(args.domain || "").trim();
      const buffers = typeof args.buffers === "object" && args.buffers ? (args.buffers as any) : {};
      const result = globalTranscendentalEngine.baddeleyWorkingMemory(domain, buffers);
      res.json({ success: true, ok: true, data: result });
    } catch (e: any) {
      res.json({ success: true, ok: false, data: { error: `Working memory evaluation failed: ${e.message}` } });
    }
    return true;
  }

  if (tool === "web_dialectical_synthesis") {
    try {
      const domain = String(args.domain || "").trim();
      const plan = typeof args.plan === "object" && args.plan ? (args.plan as any) : {};
      const result = globalTranscendentalEngine.dialecticalSynthesis(domain, plan);
      res.json({ success: true, ok: true, data: result });
    } catch (e: any) {
      res.json({ success: true, ok: false, data: { error: `Dialectical synthesis failed: ${e.message}` } });
    }
    return true;
  }

  if (tool === "web_generative_wisdom_capsule") {
    try {
      const action = String(args.action || "export").trim();
      const result = globalTranscendentalEngine.generativeWisdomCapsule(action, args as any);
      res.json({ success: true, ok: true, data: result });
    } catch (e: any) {
      res.json({ success: true, ok: false, data: { error: `Wisdom capsule operation failed: ${e.message}` } });
    }
    return true;
  }

  return false;
}
