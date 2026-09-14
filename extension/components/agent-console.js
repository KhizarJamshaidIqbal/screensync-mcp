import { escapeHtml } from '../lib/escape.js';
// ScreenSync Agent Console & Task UI (Rev 4 Items D2, D4, D5)
// Provides a natural-language command console, task progress cards,
// and takeover / hand-off banner for human-in-the-loop interactions.

export function mountAgentConsole(container, send, toast) {
  if (!container) return null;

  container.innerHTML = `
    <div class="agent-console-wrap">
      <!-- Takeover Banner (D2) -->
      <div id="agent-takeover-banner" class="takeover-box" style="display:none; background:rgba(245,158,11,0.15); border:1px solid #f59e0b; border-radius:var(--r-md); padding:var(--sp-4); margin-bottom:var(--sp-4);">
        <div class="row spread" style="align-items:flex-start">
          <div>
            <div class="row" style="gap:var(--sp-2)">
              <span class="pill warn">Takeover Requested</span>
              <strong id="takeover-reason" style="color:#fbbf24">Login / 2FA Required</strong>
            </div>
            <p id="takeover-msg" style="margin-top:var(--sp-2); font-size:var(--text-sm); color:var(--fg-muted)">Please complete verification in your browser tab.</p>
          </div>
          <div class="row" style="gap:var(--sp-2)">
            <input type="text" id="takeover-notes" placeholder="Notes for agent..." style="background:var(--bg-subtle); border:1px solid var(--border); border-radius:var(--r-sm); padding:6px 10px; font-size:var(--text-xs); color:var(--fg); width:180px;">
            <button class="btn btn-primary btn-sm" id="btn-resume-takeover">Resume Agent</button>
          </div>
        </div>
      </div>

      <!-- Command Console (D4) -->
      <section class="card" style="margin-bottom:var(--sp-4);">
        <div class="row spread" style="margin-bottom:var(--sp-3)">
          <strong>Agent Command Console</strong>
          <span class="dim" style="font-size:var(--text-xs)">Direct Browser Driver</span>
        </div>
        <div class="row" style="gap:var(--sp-2); margin-bottom:var(--sp-3)">
          <input type="text" id="console-cmd-input" placeholder="Enter prompt or tool (e.g. web_page_digest, or 'read headlines')..." style="flex:1; background:var(--bg-subtle); border:1px solid var(--border); border-radius:var(--r-md); padding:8px 12px; color:var(--fg); font-size:var(--text-sm);">
          <button class="btn btn-primary btn-sm" id="btn-console-send">Run</button>
        </div>
        <div class="row" style="gap:var(--sp-2); margin-bottom:var(--sp-3); flex-wrap:wrap">
          <button class="btn btn-ghost btn-xs console-quick" data-tool="web_screenshot">📸 Screenshot</button>
          <button class="btn btn-ghost btn-xs console-quick" data-tool="web_page_digest">📄 Page Digest</button>
          <button class="btn btn-ghost btn-xs console-quick" data-tool="web_actionable" data-args='{"selector":"button, a"}'>🎯 Check Actionable</button>
          <button class="btn btn-ghost btn-xs console-quick" data-tool="web_tabs">📑 List Tabs</button>
          <button class="btn btn-ghost btn-xs console-quick" data-tool="web_keep_alive" data-args='{"action":"protect"}'>🛡️ Protect Tab</button>
        </div>
        <div id="console-output" class="mono" style="background:var(--bg-surface); border:1px solid var(--border); border-radius:var(--r-sm); padding:var(--sp-3); font-size:11px; max-height:200px; overflow-y:auto; display:none; white-space:pre-wrap; word-break:break-word;"></div>
      </section>

      <!-- Task Card & Jobs UI (D5) -->
      <section class="card">
        <div class="row spread" style="margin-bottom:var(--sp-3)">
          <strong>Background Tasks & Jobs</strong>
          <button class="btn btn-ghost btn-xs" id="btn-refresh-jobs">Refresh</button>
        </div>
        <div id="jobs-list" style="display:flex; flex-direction:column; gap:var(--sp-2);">
          <div class="dim" style="font-size:var(--text-xs); text-align:center; padding:var(--sp-3)">No active background jobs</div>
        </div>
      </section>
    </div>
  `;

  const takeoverBanner = container.querySelector('#agent-takeover-banner');
  const takeoverReason = container.querySelector('#takeover-reason');
  const takeoverMsg = container.querySelector('#takeover-msg');
  const takeoverNotes = container.querySelector('#takeover-notes');
  const btnResume = container.querySelector('#btn-resume-takeover');

  const cmdInput = container.querySelector('#console-cmd-input');
  const btnSend = container.querySelector('#btn-console-send');
  const consoleOutput = container.querySelector('#console-output');
  const jobsList = container.querySelector('#jobs-list');
  const btnRefreshJobs = container.querySelector('#btn-refresh-jobs');

  // Resume Takeover handler
  btnResume.addEventListener('click', async () => {
    const userNotes = takeoverNotes.value.trim() || 'Completed human step';
    const res = await send({ type: 'resume-takeover', userNotes, success: true });
    if (res && res.ok) {
      if (toast) toast('Takeover resumed cleanly', 'ok');
      takeoverBanner.style.display = 'none';
      takeoverNotes.value = '';
    } else {
      if (toast) toast((res && res.error) || 'Failed to resume takeover', 'error');
    }
  });

  // Check takeover status periodically
  async function pollTakeover() {
    try {
      const res = await send({ type: 'get-takeover' });
      if (res && res.ok && res.takeover && res.takeover.active) {
        takeoverReason.textContent = res.takeover.reason ? res.takeover.reason.toUpperCase() : 'MANUAL TAKEOVER';
        takeoverMsg.textContent = res.takeover.message || 'Please complete human verification and click Resume.';
        takeoverBanner.style.display = 'block';
      } else {
        takeoverBanner.style.display = 'none';
      }
    } catch {}
  }

  // Command Execution
  async function executeConsoleCmd(toolName, rawArgs = {}) {
    consoleOutput.style.display = 'block';
    consoleOutput.textContent = `Executing ${toolName}...\n`;
    try {
      const res = await send({
        type: 'web-test',
        tool: toolName,
        args: rawArgs,
      });
      consoleOutput.textContent = JSON.stringify(res, null, 2);
      if (toast) toast(`${toolName} complete`, 'ok');
    } catch (e) {
      consoleOutput.textContent = `Error: ${e.message}`;
      if (toast) toast(e.message, 'error');
    }
  }

  btnSend.addEventListener('click', () => {
    const query = cmdInput.value.trim();
    if (!query) return;
    executeConsoleCmd(query.startsWith('web_') ? query : 'web_page_digest');
  });

  cmdInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') btnSend.click();
  });

  container.querySelectorAll('.console-quick').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tool = btn.dataset.tool;
      const args = btn.dataset.args ? JSON.parse(btn.dataset.args) : {};
      executeConsoleCmd(tool, args);
    });
  });

  // Jobs Rendering
  async function renderJobs() {
    try {
      const res = await send({ type: 'get-jobs' });
      const jobs = (res && res.ok && res.jobs) || [];
      if (jobs.length === 0) {
        jobsList.innerHTML = `<div class="dim" style="font-size:var(--text-xs); text-align:center; padding:var(--sp-3)">No active background jobs</div>`;
        return;
      }
      jobsList.innerHTML = '';
      for (const j of jobs) {
        const title = j.goal || j.name || j.id;
        const state = j.state || j.status || 'idle';
        const pct = j.progress && typeof j.progress === 'object' && j.progress.total > 0
          ? Math.round((j.progress.current / j.progress.total) * 100)
          : Math.round(Number(j.progress) || 0);
        const stage = j.stage || (j.steps ? `${j.steps.filter((s) => s.status === 'completed').length}/${j.steps.length} steps completed` : '');
        const isRunning = state === 'running' || state === 'idle';

        const row = document.createElement('div');
        row.style.background = 'var(--bg-subtle)';
        row.style.border = '1px solid var(--border)';
        row.style.borderRadius = 'var(--r-sm)';
        row.style.padding = 'var(--sp-2) var(--sp-3)';
        row.innerHTML = `
          <div class="row spread">
            <div>
              <strong>${escapeHtml(title)}</strong>
              <span class="pill ${state === 'running' ? 'ok' : state === 'cancelled' ? 'warn' : 'off'}" style="margin-left:6px; font-size:10px">${state}</span>
            </div>
            <div class="row" style="gap:var(--sp-2)">
              <span class="dim" style="font-size:11px">${pct}%</span>
              ${isRunning ? `<button class="btn btn-ghost btn-xs btn-cancel-job" data-id="${j.id}" style="color:#ef4444">Cancel</button>` : ''}
            </div>
          </div>
          <div style="background:var(--border); height:4px; border-radius:2px; margin-top:6px; overflow:hidden">
            <div style="background:var(--primary); height:100%; width:${Math.min(Math.max(pct, 0), 100)}%"></div>
          </div>
          ${stage ? `<div class="dim" style="font-size:11px; margin-top:4px">${escapeHtml(stage)}</div>` : ''}
        `;
        jobsList.appendChild(row);
      }

      jobsList.querySelectorAll('.btn-cancel-job').forEach((btn) => {
        btn.addEventListener('click', async () => {
          await send({ type: 'cancel-job', id: btn.dataset.id });
          renderJobs();
        });
      });
    } catch {}
  }

  btnRefreshJobs.addEventListener('click', renderJobs);

  // Initial polls
  pollTakeover();
  renderJobs();
  const pollInterval = setInterval(() => {
    pollTakeover();
    renderJobs();
  }, 4000);

  return {
    refresh: () => {
      pollTakeover();
      renderJobs();
    },
    destroy: () => clearInterval(pollInterval),
  };
}
