import assert from 'node:assert/strict';
import { fetchThreatState } from '../lib/threat-state.js';
import { execWebAmygdalaThreatInoculation } from '../lib/cognitive-transcendental-ext.js';

console.log('[test] running threat state read-path tests (Architecture 12.0)...');

// 1. Asks the hub for a READ (action:'state'), on the right tool, and unwraps the threats.
{
  const seen = [];
  const call = async (tool, args) => {
    seen.push({ tool, args });
    return { ok: true, data: { threats: [{ domain: 'guarded.test', breakerState: 'TRIPPED' }], tracked: 1 } };
  };
  const out = await fetchThreatState(undefined, call);
  assert.deepEqual(out, { ok: true, threats: [{ domain: 'guarded.test', breakerState: 'TRIPPED' }] });
  assert.equal(seen[0].tool, 'web_amygdala_threat_inoculation');
  assert.equal(seen[0].args.action, 'state', 'the panel must only ever READ the breaker');
  assert.ok(!('domain' in seen[0].args), 'no domain means every tracked domain');
}

// 2. A domain, when given, is passed through.
{
  let args;
  await fetchThreatState('x.com', async (_t, a) => { args = a; return { ok: true, data: { threats: [] } }; });
  assert.equal(args.domain, 'x.com');
  assert.equal(args.action, 'state');
}

// 3. Empty is a real answer when the hub says so.
{
  const out = await fetchThreatState(undefined, async () => ({ ok: true, data: { threats: [] } }));
  assert.deepEqual(out, { ok: true, threats: [] });
}

// 4. The dangerous cases: anything that is not a clean answer must be an ERROR. The panel
// renders {ok:true, threats:[]} as "every breaker is armed", so an unreachable or confused hub
// must never collapse into that shape.
{
  const unreachable = await fetchThreatState(undefined, async () => { throw new Error('connect ECONNREFUSED 127.0.0.1:3000'); });
  assert.equal(unreachable.ok, false);
  assert.match(unreachable.error, /ECONNREFUSED/);
  assert.ok(!('threats' in unreachable), 'an error must not carry an empty threats list');

  const refused = await fetchThreatState(undefined, async () => ({ ok: false, data: { error: 'hub said no' } }));
  assert.deepEqual(refused, { ok: false, error: 'hub said no' });

  const noBody = await fetchThreatState(undefined, async () => undefined);
  assert.equal(noBody.ok, false);

  const malformed = await fetchThreatState(undefined, async () => ({ ok: true, data: {} }));
  assert.equal(malformed.ok, false);
  assert.match(malformed.error, /malformed/);

  const notAnArray = await fetchThreatState(undefined, async () => ({ ok: true, data: { threats: 'none' } }));
  assert.equal(notAnArray.ok, false);
}

// 5. The extension's own mirror of the tool honours the same contract: a state read can never
// move the breaker, and an appraisal needs a domain.
{
  const trip = await execWebAmygdalaThreatInoculation({ domain: 'mirror-guarded.test', signal: { fingerprint: 'recaptcha' } });
  assert.equal(trip.data.breakerState, 'TRIPPED');

  const a = await execWebAmygdalaThreatInoculation({ action: 'state', domain: 'mirror-guarded.test' });
  const b = await execWebAmygdalaThreatInoculation({ action: 'state', domain: 'mirror-guarded.test' });
  assert.equal(a.data.threats.length, 1);
  assert.equal(a.data.threats[0].breakerState, 'TRIPPED');
  assert.deepEqual(b.data.threats, a.data.threats, 'reading must be inert');
  assert.equal(a.data.threats[0].consecutiveTrips, 1);

  const refused = await execWebAmygdalaThreatInoculation({ signal: { fingerprint: 'recaptcha' } });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /domain is required/);
}

console.log('[test] threat state read-path tests passed');
