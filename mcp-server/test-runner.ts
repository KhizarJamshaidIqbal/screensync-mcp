// ScreenSync Test Runner & CI Reporter Engine (P8)
// Wraps flows, steps, and assertions into named suites with auto-retry logic,
// emitting structured JSON and standard JUnit XML test reports for CI pipelines.

export interface TestCaseDef {
  name: string;
  flow?: string;
  steps?: Array<{ tool: string; args?: Record<string, unknown> }>;
  retries?: number;
  stopOnError?: boolean;
  vars?: Record<string, string>;
}

export interface TestSuiteDef {
  name: string;
  tests: TestCaseDef[];
  format?: 'json' | 'junit' | 'both';
  stepTimeoutMs?: number;
}

export interface TestCaseResult {
  name: string;
  ok: boolean;
  durationMs: number;
  attempts: number;
  error?: string;
  executedSteps: number;
  stepResults?: Array<Record<string, unknown>>;
}

export interface TestSuiteResult {
  name: string;
  timestamp: string;
  totalDurationMs: number;
  totalTests: number;
  passed: number;
  failed: number;
  tests: TestCaseResult[];
  junitXml?: string;
}

/**
 * Escapes XML entities for JUnit XML.
 */
function escXml(str: unknown): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Formats test suite results into standard JUnit XML 0.4.
 */
export function formatJUnitXml(suite: TestSuiteResult): string {
  const durationSec = (suite.totalDurationMs / 1000).toFixed(3);
  const lines: string[] = [];

  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(`<testsuites name="ScreenSync Test Runner" tests="${suite.totalTests}" failures="${suite.failed}" errors="0" time="${durationSec}">`);
  lines.push(`  <testsuite name="${escXml(suite.name)}" tests="${suite.totalTests}" failures="${suite.failed}" errors="0" time="${durationSec}" timestamp="${suite.timestamp}">`);

  for (const t of suite.tests) {
    const caseSec = (t.durationMs / 1000).toFixed(3);
    if (t.ok) {
      lines.push(`    <testcase classname="${escXml(suite.name)}" name="${escXml(t.name)}" time="${caseSec}" />`);
    } else {
      lines.push(`    <testcase classname="${escXml(suite.name)}" name="${escXml(t.name)}" time="${caseSec}">`);
      lines.push(`      <failure message="${escXml(t.error || 'Test assertion failed')}" type="AssertionError">${escXml(t.error || 'Test failed')}</failure>`);
      lines.push(`    </testcase>`);
    }
  }

  lines.push(`  </testsuite>`);
  lines.push(`</testsuites>`);
  return lines.join('\n');
}

/**
 * Outcomes a retry must not repeat: a person declined or did not answer an approval prompt, the cognitive gate
 * refused the step, the call ran out of its time budget, or the hub is stopping. Retrying would put the same
 * prompt in front of the person again (USER_DECLINED says "Do not retry it") or wait out the same window again.
 */
const FINAL_CODES: ReadonlySet<string> = new Set([
  "USER_DECLINED", "APPROVAL_TIMEOUT", "USER_CONFIRMATION_REQUIRED", "CALL_BUDGET_SPENT", "HUB_STOPPING",
]);

type StepOutcome = { ok: boolean; data?: unknown; error?: string; code?: string };

/** True when a failed step must end its test case with no retry (see FINAL_CODES; data.gate = refused by the gate). */
export function isFinalFailure(res: StepOutcome): boolean {
  if (res.ok) return false;
  if (typeof res.code === "string" && FINAL_CODES.has(res.code)) return true;
  const data = res.data as { gate?: unknown } | null | undefined;
  return Boolean(data && typeof data === "object" && data.gate != null);
}

/**
 * Executes a test suite against a step runner callback with retries.
 */
export async function runTestSuite(
  suite: TestSuiteDef,
  stepRunner: (tool: string, args: Record<string, unknown>) => Promise<StepOutcome>
): Promise<TestSuiteResult> {
  const startTime = Date.now();
  const testResults: TestCaseResult[] = [];
  let passedCount = 0;
  let failedCount = 0;

  for (const tc of suite.tests || []) {
    const tcStart = Date.now();
    const maxRetries = Math.max(0, Math.min(Number(tc.retries) || 0, 5));
    let attempts = 0;
    let success = false;
    let lastError: string | undefined;
    let lastStepResults: Array<Record<string, unknown>> = [];
    let executedCount = 0;
    let final = false;

    while (attempts <= maxRetries && !success && !final) {
      attempts++;
      lastError = undefined;
      lastStepResults = [];
      executedCount = 0;
      let stepFail = false;

      for (let i = 0; i < (tc.steps || []).length; i++) {
        const step = tc.steps![i];
        executedCount++;
        try {
          const res = await stepRunner(step.tool, step.args || {});
          lastStepResults.push({ step: i + 1, tool: step.tool, ok: res.ok, data: res.data, error: res.error });
          if (!res.ok) {
            stepFail = true;
            lastError = res.error || `Step ${i + 1} (${step.tool}) failed`;
            if (isFinalFailure(res)) final = true;
            if (tc.stopOnError !== false) break;
          }
        } catch (e) {
          stepFail = true;
          lastError = String((e && (e as Error).message) || e);
          lastStepResults.push({ step: i + 1, tool: step.tool, ok: false, error: lastError });
          if (tc.stopOnError !== false) break;
        }
      }

      if (!stepFail) {
        success = true;
      }
    }

    if (success) passedCount++;
    else failedCount++;

    testResults.push({
      name: tc.name,
      ok: success,
      durationMs: Date.now() - tcStart,
      attempts,
      error: lastError,
      executedSteps: executedCount,
      stepResults: lastStepResults,
    });
  }

  const result: TestSuiteResult = {
    name: suite.name || 'ScreenSync Suite',
    timestamp: new Date().toISOString(),
    totalDurationMs: Date.now() - startTime,
    totalTests: (suite.tests || []).length,
    passed: passedCount,
    failed: failedCount,
    tests: testResults,
  };

  const fmt = String(suite.format || 'both').toLowerCase();
  if (fmt === 'junit' || fmt === 'both') {
    result.junitXml = formatJUnitXml(result);
  }

  return result;
}
