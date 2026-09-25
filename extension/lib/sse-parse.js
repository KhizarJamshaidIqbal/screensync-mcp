// Pure text/event-stream framing (no I/O, no chrome.*), shared by lib/sse-client.js and its tests.
// The hub writes `id: <seq>\ndata: {json}\n\n` events and `: keepalive` comments. A chunk boundary may
// fall anywhere, including between the CR and LF of a CRLF, so an incomplete tail is returned as `rest`
// and must be prepended to the next chunk.

// One event block (lines already split on '\n') -> { id, data } or null when it carries no data.
function parseBlock(block) {
  const data = [];
  let id = null;
  for (const line of block.split('\n')) {
    if (!line || line.startsWith(':')) continue; // blank line or comment (keepalive, "connected")
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') data.push(value);
    else if (field === 'id' && !value.includes('\0')) id = value;
  }
  return data.length ? { id, data: data.join('\n') } : null;
}

/**
 * Splits buffered stream text into complete events.
 * @param {string} buffer text received so far (previous `rest` + the newly decoded chunk)
 * @returns {{ events: Array<{ id: string|null, data: string }>, rest: string }}
 */
export function parseSseChunk(buffer) {
  let src = String(buffer ?? '');
  // A trailing CR may be the first half of a CRLF split across chunks: keep it raw for the next call.
  let tail = '';
  if (src.endsWith('\r')) {
    tail = '\r';
    src = src.slice(0, -1);
  }
  const blocks = src.replace(/\r\n|\r/g, '\n').split('\n\n');
  const rest = blocks.pop() + tail;
  const events = [];
  for (const block of blocks) {
    const ev = parseBlock(block);
    if (ev) events.push(ev);
  }
  return { events, rest };
}
