// ScreenSync Cognitive Tool Handlers - Architecture 12.0 (sleep consolidation, reflex compilation,
// threat inoculation, ZPD tutoring, somatic markers, working memory, dialectics, wisdom capsules)
// Registered through web-cognitive-handlers.ts (rule 2: single responsibility + file-size limit).

import type { Response } from "express";
import { globalTranscendentalEngine } from "./cognitive-transcendental.js";

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
      const result = globalTranscendentalEngine.system1ReflexCompile(domain, playbook);
      res.json({ success: true, ok: true, data: result });
    } catch (e: any) {
      res.json({ success: true, ok: false, data: { error: `Reflex compilation failed: ${e.message}` } });
    }
    return true;
  }

  if (tool === "web_amygdala_threat_inoculation") {
    try {
      const domain = String(args.domain || "").trim();
      const signal = typeof args.signal === "object" && args.signal ? (args.signal as any) : {};
      const result = globalTranscendentalEngine.amygdalaThreatInoculation(domain, signal);
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
