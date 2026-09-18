/**
 * Render a VOM node tree as indented text with ref numbers.
 * Output format:
 *   [page] My Website (1920×1080)
 *     [nav] Main Navigation  
 *       [link @1] Home
 *       [button @3] Sign In
 *     [dialog BLOCKING] Cookie Consent
 *       [button @6] Accept All
 */
export function renderVomTree(nodes, options = {}) {
  return renderNodes(nodes, 0, options);
}

export function renderVomContinuation(nodes, startIndex, options = {}) {
  return renderNodes(nodes, startIndex, options);
}

function renderNodes(nodes, startIndex, options) {
  const { maxTokens = 4000, viewport, blockingLayers = [], url, title } = options;
  let text = '';
  const refs = [];
  let tokenCount = 0;
  let nextRefId = options.startRefId || 1;
  let i = startIndex;
  
  if (startIndex === 0 && viewport) {
    const pageTitle = title || (nodes[0]?.role === 'RootWebArea' ? nodes[0].name : '') || 'Unknown Title';
    text += `[page] ${pageTitle} (${viewport.width}×${viewport.height})\n`;
    if (url) text += `URL: ${url}\n`;
    tokenCount += 15;
    
    if (blockingLayers.length > 0) {
      for (const bl of blockingLayers) {
        text += `⚠ BLOCKING: ${bl.kind} covers ${bl.coverage}% of viewport\n`;
        tokenCount += 10;
      }
    }
    text += '\n';
  }

  const blockingNodeIds = new Set();
  for (const bl of blockingLayers) {
      blockingNodeIds.add(bl.rootId);
  }

  for (; i < nodes.length; i++) {
    const node = nodes[i];
    if (startIndex === 0 && i === 0 && node.role === 'RootWebArea') {
      continue;
    }

    const nodeTokens = typeof node.tokens === 'number' ? node.tokens : (
      (node.interactive ? 15 : 8) + Math.ceil(((node.name || '').length + (node.value || '').length) / 4)
    );
    
    if (tokenCount + nodeTokens > maxTokens) {
      break;
    }
    
    const indent = '  '.repeat(Math.max(0, node.depth || 0));
    let line = `${indent}[${node.role}`;
    
    if (blockingNodeIds.has(node.id)) {
        line += ' BLOCKING';
    }
    
    if (node.interactive) {
        const refId = nextRefId++;
        line += ` @${refId}`;
        refs.push({
            ref: refId,
            backendNodeId: node.backendNodeId,
            role: node.role,
            name: node.name,
            line: i
        });
    }
    line += ']';
    
    if (node.name) {
        line += ` ${node.name}`;
    }
    
    if (node.value) {
        line += ` "${node.value}"`;
    }
    
    const states = [];
    if (node.checked === 'true' || node.checked === true) states.push('checked');
    else if (node.checked === 'false' || node.checked === false) states.push('unchecked');
    if (node.disabled) states.push('disabled');
    if (node.expanded === true) states.push('expanded');
    else if (node.expanded === false) states.push('collapsed');
    
    if (states.length > 0) {
        line += ` (${states.join(', ')})`;
    }
    
    text += line + '\n';
    tokenCount += nodeTokens;
  }
  
  const truncated = i < nodes.length;
  
  return {
    text,
    refs,
    truncated,
    lastIndex: i
  };
}
