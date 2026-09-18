// ScreenSync Metacognitive Reflex & Confidence Calibration Engine (Architecture 4.0)
// Synthesizes Human Metacognitive Monitoring (Flavell) & Dual-Process Theory (Kahneman System 1 vs 2)
// Inspired by GCP Data Pipelines telemetry stream monitoring and anomaly detection.

export type ExecutionMode = "SYSTEM_1_REFLEX" | "SYSTEM_2_DELIBERATE" | "EXPLORATION_FALLBACK";

export interface MetacognitiveEvaluation {
  domain: string;
  intent: string;
  confidenceScore: number;
  mode: ExecutionMode;
  targetDurationSeconds: number;
  factors: {
    successRate: number;
    domStability: number;
    probeReliability: number;
    environmentalCalm: number;
  };
  anomalyDetected: boolean;
  adjustedTimeoutMs: number;
  guidance: string;
}

export class MetacognitiveReflexEngine {
  private latencyTelemetry: Map<string, number[]> = new Map();

  public recordLatency(domain: string, latencyMs: number): void {
    const list = this.latencyTelemetry.get(domain) || [];
    list.push(latencyMs);
    if (list.length > 50) list.shift();
    this.latencyTelemetry.set(domain, list);
  }

  public evaluateConfidence(params: {
    domain: string;
    intent?: string;
    playbookSuccessCount?: number;
    playbookFailCount?: number;
    driftCount?: number;
    failedProbesCount?: number;
    currentLatencyMs?: number;
  }): MetacognitiveEvaluation {
    const {
      domain,
      intent = "general",
      playbookSuccessCount = 3,
      playbookFailCount = 0,
      driftCount = 0,
      failedProbesCount = 0,
      currentLatencyMs,
    } = params;

    // 1. Success Rate (Weight 0.40)
    const totalExecutions = playbookSuccessCount + playbookFailCount;
    const successRate = totalExecutions > 0 ? playbookSuccessCount / totalExecutions : 0.5;

    // 2. DOM Stability Index (Weight 0.30)
    const domStability = Math.max(0.1, 1.0 - driftCount * 0.25);

    // 3. Sensory Probe Reliability (Weight 0.20)
    const probeReliability = Math.max(0.1, 1.0 - failedProbesCount * 0.3);

    // 4. Environmental Calm & Latency Anomaly Detection (Weight 0.10)
    const history = this.latencyTelemetry.get(domain) || [800, 950, 900, 850];
    const avgLatency = history.reduce((a, b) => a + b, 0) / (history.length || 1);
    let anomalyDetected = false;
    let environmentalCalm = 1.0;

    if (currentLatencyMs !== undefined && currentLatencyMs > avgLatency * 2.2) {
      anomalyDetected = true;
      environmentalCalm = 0.3; // Server throttling or bot challenges suspected
    }

    // Calibrated Score
    const confidenceScore = Number(
      (0.4 * successRate + 0.3 * domStability + 0.2 * probeReliability + 0.1 * environmentalCalm).toFixed(3)
    );

    // Mode Selection (System 1 vs System 2)
    let mode: ExecutionMode = "EXPLORATION_FALLBACK";
    let targetDurationSeconds = 30;
    let adjustedTimeoutMs = 15000;
    let guidance = "Unknown or unstable environment. Use deliberate inspection before acting.";

    if (confidenceScore >= 0.85) {
      mode = "SYSTEM_1_REFLEX";
      targetDurationSeconds = 3;
      adjustedTimeoutMs = 5000;
      guidance = "High confidence fast-path. Fire atomic motor steps directly (< 3s execution).";
    } else if (confidenceScore >= 0.50) {
      mode = "SYSTEM_2_DELIBERATE";
      targetDurationSeconds = 12;
      adjustedTimeoutMs = 12000;
      guidance = "Moderate confidence. Execute with step-by-step VOM/AX perception validation.";
    }

    if (anomalyDetected) {
      adjustedTimeoutMs = Math.max(adjustedTimeoutMs, 20000);
      guidance += " [Warning: High latency variance detected. Extended backoff timeouts active.]";
    }

    return {
      domain,
      intent,
      confidenceScore,
      mode,
      targetDurationSeconds,
      factors: {
        successRate: Number(successRate.toFixed(2)),
        domStability: Number(domStability.toFixed(2)),
        probeReliability: Number(probeReliability.toFixed(2)),
        environmentalCalm: Number(environmentalCalm.toFixed(2)),
      },
      anomalyDetected,
      adjustedTimeoutMs,
      guidance,
    };
  }
}

export const globalMetacognitiveEngine = new MetacognitiveReflexEngine();
