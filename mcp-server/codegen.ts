// ScreenSync Codegen Engine (P9)
// Converts recorded browser sessions (web_record) into runnable web_flow_save payloads
// and executable Playwright test scripts.

export interface RecordedStep {
  tool: string;
  args?: Record<string, unknown>;
}

export interface GeneratedFlow {
  name: string;
  savedAt: string;
  stepCount: number;
  steps: RecordedStep[];
}

/**
 * Filter out internal recording and observer tools that should not be part of recorded workflows.
 */
const IGNORED_TOOLS = new Set([
  'web_record',
  'web_replay',
  'web_events',
  'web_status',
  'web_extension_diagnostics',
  'web_audit_log',
]);

/**
 * Sanitizes and cleans steps recorded during a session into a reusable flow definition.
 */
export function generateFlow(steps: RecordedStep[], name = 'recorded_flow'): GeneratedFlow {
  const sanitized: RecordedStep[] = [];

  for (const step of steps || []) {
    if (!step || !step.tool || IGNORED_TOOLS.has(step.tool)) continue;
    const cleanArgs: Record<string, unknown> = {};
    if (step.args && typeof step.args === 'object') {
      for (const [k, v] of Object.entries(step.args)) {
        if (k.startsWith('__')) continue; // strip internal routing tags like __browser
        if (v !== undefined && v !== null && v !== '') {
          cleanArgs[k] = v;
        }
      }
    }
    sanitized.push({ tool: step.tool, args: cleanArgs });
  }

  return {
    name: name.trim() || 'recorded_flow',
    savedAt: new Date().toISOString(),
    stepCount: sanitized.length,
    steps: sanitized,
  };
}

/**
 * Converts recorded steps into an executable Playwright test script.
 */
export function generatePlaywright(steps: RecordedStep[], testName = 'recorded user journey'): string {
  const flow = generateFlow(steps, testName);
  const lines: string[] = [];

  lines.push(`import { test, expect } from '@playwright/test';`);
  lines.push(``);
  lines.push(`test('${testName.replace(/'/g, "\\'")}', async ({ page }) => {`);

  for (const step of flow.steps) {
    const args = step.args || {};
    const sel = String(args.selector ?? args.ref ?? '').replace(/'/g, "\\'");

    switch (step.tool) {
      case 'web_navigate':
        lines.push(`  await page.goto('${String(args.url || 'about:blank').replace(/'/g, "\\'")}');`);
        break;
      case 'web_click':
        if (sel) lines.push(`  await page.locator('${sel}').click();`);
        else lines.push(`  await page.mouse.click(${Number(args.x) || 0}, ${Number(args.y) || 0});`);
        break;
      case 'web_fill':
      case 'web_type':
        lines.push(`  await page.locator('${sel}').fill('${String(args.text ?? args.value ?? '').replace(/'/g, "\\'")}');`);
        break;
      case 'web_check':
        lines.push(`  await page.locator('${sel}').check();`);
        break;
      case 'web_scroll_to':
        if (sel) lines.push(`  await page.locator('${sel}').scrollIntoViewIfNeeded();`);
        else lines.push(`  await page.evaluate(() => window.scrollTo(0, ${args.position === 'bottom' ? 'document.body.scrollHeight' : '0'}));`);
        break;
      case 'web_expect':
        if (args.text) {
          lines.push(`  await expect(page.locator('${sel}')).toContainText('${String(args.text).replace(/'/g, "\\'")}');`);
        } else if (args.not) {
          lines.push(`  await expect(page.locator('${sel}')).toBeHidden();`);
        } else {
          lines.push(`  await expect(page.locator('${sel}')).toBeVisible();`);
        }
        break;
      case 'web_screenshot':
        lines.push(`  await page.screenshot({ path: '${String(args.filename || 'screenshot.png').replace(/'/g, "\\'")}' });`);
        break;
      case 'web_eval':
        lines.push(`  await page.evaluate(() => {\n    ${String(args.code || '').trim()}\n  });`);
        break;
      default:
        lines.push(`  // Custom step: ${step.tool} ${JSON.stringify(args)}`);
        break;
    }
  }

  lines.push(`});`);
  lines.push(``);

  return lines.join('\n');
}
