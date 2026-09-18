import { rawAttach, rawDetach } from './web-adv-core.js';
import { renderVomTree, renderVomContinuation } from './web-vom-renderer.js';

const SKIP_ROLES = new Set([
  'none', 'presentation', 'generic', 'inlineTextBox', 'StaticText', 
  'lineBreak', 'Ignored', 'unknown'
]);

const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'textbox', 'checkbox', 'radio', 'combobox', 'slider',
  'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'switch',
  'spinbutton', 'searchbox', 'listbox', 'treeitem', 'gridcell'
]);

/**
 * Build a Visual Object Model (VOM) from CDP AXTree + DOMSnapshot.
 * Zero DOM mutations — all perception is read-only via CDP.
 */
export async function buildVom(tab, args = {}) {
  const target = { tabId: tab.id };
  const maxTokens = Math.min(Math.max(Number(args.maxTokens) || 4000, 500), 32000);
  const cursor = args.cursor || null;  // e.g. "node:145"
  const includeOccluded = args.includeOccluded === true;
  
  let attached = false;
  try {
    await rawAttach(target);
    attached = true;
  } catch (e) {
    if (String((e && e.message) || e).includes('Already attached')) attached = true;
    else return { ok: false, error: `CDP attach failed: ${String((e && e.message) || e)}` };
  }
  
  try {
    // 1. Enable required domains
    await chrome.debugger.sendCommand(target, 'Accessibility.enable', {});
    await chrome.debugger.sendCommand(target, 'DOM.enable', {});
    
    // 2. Get full AX tree
    const axResult = await chrome.debugger.sendCommand(target, 'Accessibility.getFullAXTree', {});
    const axNodes = axResult.nodes || [];
    
    // 3. Get DOM snapshot with computed styles
    const snapshot = await chrome.debugger.sendCommand(target, 'DOMSnapshot.captureSnapshot', {
      computedStyles: ['display','visibility','opacity','position','z-index','pointer-events','overflow','top','left','width','height']
    });
    
    // 4. Get viewport metrics
    const metrics = await chrome.debugger.sendCommand(target, 'Page.getLayoutMetrics', {});
    const viewport = {
      width: metrics.cssVisualViewport?.clientWidth || metrics.visualViewport?.clientWidth || 1920,
      height: metrics.cssVisualViewport?.clientHeight || metrics.visualViewport?.clientHeight || 1080
    };
    
    // 5. Build backendNodeId -> DOM geometry map from snapshot
    const geometryMap = buildGeometryMap(snapshot);
    
    // 6. Join AX nodes with geometry
    const vomNodes = joinAxWithGeometry(axNodes, geometryMap, viewport);
    
    // 7. Detect blocking layers (modals, cookie banners)
    const blockingLayers = detectBlockingLayers(vomNodes, viewport);
    
    // 8. Filter occluded nodes if not requested
    const filteredNodes = includeOccluded ? vomNodes : 
      vomNodes.filter(n => !n.occluded || n.interactive);
    
    // 9. Render with token budget and cursor
    const startIndex = cursor ? parseCursor(cursor) : 0;
    const rendered = cursor ? 
      renderVomContinuation(filteredNodes, startIndex, { maxTokens }) :
      renderVomTree(filteredNodes, { maxTokens, viewport, blockingLayers, url: tab.url, title: tab.title });
    
    return {
      ok: true,
      data: {
        text: rendered.text,
        refs: rendered.refs,
        viewport,
        truncated: rendered.truncated,
        cursor: rendered.truncated ? `node:${rendered.lastIndex}` : null,
        blockingLayers: blockingLayers.map(l => ({ kind: l.kind, coverage: l.coverage })),
        nodeCount: filteredNodes.length,
        url: tab.url,
        title: tab.title,
      }
    };
  } catch (err) {
    return { ok: false, error: `VOM build error: ${String((err && err.message) || err)}` };
  } finally {
    try {
      await chrome.debugger.sendCommand(target, 'Accessibility.disable', {}).catch(() => {});
      await chrome.debugger.sendCommand(target, 'DOM.disable', {}).catch(() => {});
    } catch {}
    if (attached) await rawDetach(target);
  }
}

function buildGeometryMap(snapshot) {
  const map = new Map();
  if (!snapshot.documents) return map;
  
  for (const doc of snapshot.documents) {
    const nodes = doc.nodes || {};
    const layout = doc.layout || {};
    const backendNodeId = nodes.backendNodeId || [];
    const nodeName = nodes.nodeName || [];
    const layoutNodeIndex = layout.nodeIndex || [];
    const bounds = layout.bounds || [];
    const paintOrders = layout.paintOrders || [];
    const styles = layout.styles || [];
    const strings = snapshot.strings || [];

    for (let i = 0; i < layoutNodeIndex.length; i++) {
      const nIdx = layoutNodeIndex[i];
      const bNodeId = backendNodeId[nIdx];
      
      const b = bounds[i];
      const rect = b ? { x: b[0], y: b[1], width: b[2], height: b[3] } : null;
      
      const st = styles[i] || [];
      const computedStyles = {};
      
      if (st.length > 0) {
        const keys = ['display','visibility','opacity','position','z-index','pointer-events','overflow','top','left','width','height'];
        for (let j = 0; j < keys.length; j++) {
            const strIdx = st[j];
            if (strIdx !== undefined && strIdx !== -1) {
                computedStyles[keys[j]] = strings[strIdx];
            }
        }
      }
      
      if (bNodeId) {
        map.set(bNodeId, {
          rect,
          paintOrder: paintOrders[i] || 0,
          computedStyles,
          nodeName: strings[nodeName[nIdx]] || ''
        });
      }
    }
  }
  return map;
}

function joinAxWithGeometry(axNodes, geometryMap, viewport) {
  const vomNodes = [];
  
  for (const ax of axNodes) {
    const role = ax.role?.value || 'unknown';
    
    if (SKIP_ROLES.has(role) && !INTERACTIVE_ROLES.has(role) && !ax.name?.value) {
       continue;
    }
    
    let name = ax.name?.value || '';
    let value = ax.value?.value || '';
    let interactive = INTERACTIVE_ROLES.has(role);
    
    const props = ax.properties || [];
    let disabled = false;
    let checked = undefined;
    let expanded = undefined;
    let required = false;
    
    for (const prop of props) {
      if (prop.name === 'disabled') disabled = prop.value.value === true;
      if (prop.name === 'checked') checked = prop.value.value;
      if (prop.name === 'expanded') expanded = prop.value.value === true;
      if (prop.name === 'required') required = prop.value.value === true;
    }

    const bNodeId = ax.backendDOMNodeId;
    let geom = bNodeId ? geometryMap.get(bNodeId) : null;
    let rect = geom?.rect || null;
    let paintOrder = geom?.paintOrder || 0;
    
    let isVisible = true;
    if (geom) {
        const s = geom.computedStyles;
        if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') {
            isVisible = false;
        }
    }
    if (ax.ignored) isVisible = false;

    if (isVisible && rect) {
       if (rect.x + rect.width <= 0 || rect.y + rect.height <= 0 || 
           rect.x >= viewport.width || rect.y >= viewport.height) {
           isVisible = false;
       }
    }

    if (!isVisible && !interactive) continue;

    vomNodes.push({
      id: ax.nodeId,
      backendNodeId: bNodeId,
      parentId: ax.parentId,
      role,
      name,
      value,
      rect,
      paintOrder,
      position: geom?.computedStyles?.position || 'static',
      pointerEvents: geom?.computedStyles?.['pointer-events'] || 'auto',
      interactive,
      disabled,
      checked,
      expanded,
      required,
      tokens: 0,
      occluded: false
    });
  }
  
  for (let i = 0; i < vomNodes.length; i++) {
    const node = vomNodes[i];
    node.tokens = estimateTokens(node);
    node.occluded = isNodeOccluded(node, vomNodes);
  }
  
  return buildTree(vomNodes);
}

function buildTree(nodes) {
    const map = new Map(nodes.map(n => [n.id, { ...n, children: [] }]));
    const rootNodes = [];
    
    for (const node of map.values()) {
        if (node.parentId && map.has(node.parentId)) {
            map.get(node.parentId).children.push(node);
        } else {
            rootNodes.push(node);
        }
    }
    
    const flattened = [];
    function walk(node, currentDepth) {
        const n = { ...node, depth: currentDepth };
        delete n.children;
        flattened.push(n);
        for (const child of node.children) {
            walk(child, currentDepth + 1);
        }
    }
    for (const root of rootNodes) {
        walk(root, 0);
    }
    return flattened;
}

function detectBlockingLayers(vomNodes, viewport) {
  const blockingLayers = [];
  const viewportArea = viewport.width * viewport.height;
  
  for (const node of vomNodes) {
    if ((node.position === 'fixed' || node.position === 'absolute') && node.pointerEvents !== 'none' && node.rect) {
        const area = node.rect.width * node.rect.height;
        const coverage = area / viewportArea;
        
        if (coverage > 0.5) {
            blockingLayers.push({
                kind: coverage > 0.9 ? 'mask' : 'modal',
                rootId: node.id,
                coverage: Math.round(coverage * 100),
                members: new Set([node.id])
            });
        }
    }
  }
  return blockingLayers;
}

function isNodeOccluded(node, allNodes) {
    if (!node.rect || node.pointerEvents === 'none') return false;
    
    for (const other of allNodes) {
        if (other.id === node.id) continue;
        if (other.paintOrder > node.paintOrder && other.pointerEvents !== 'none' && other.rect) {
            if (other.rect.x <= node.rect.x &&
                other.rect.y <= node.rect.y &&
                (other.rect.x + other.rect.width) >= (node.rect.x + node.rect.width) &&
                (other.rect.y + other.rect.height) >= (node.rect.y + node.rect.height)) {
                return true;
            }
        }
    }
    return false;
}

function estimateTokens(node) {
    let t = 0;
    if (node.interactive) t += 15;
    else if (node.name || node.value) t += 8;
    else t += 3;
    
    if (node.name) t += Math.ceil(node.name.length / 4);
    if (node.value) t += Math.ceil(String(node.value).length / 4);
    return t;
}

function parseCursor(cursor) {
  const m = cursor.match(/^node:(\d+)$/);
  return m ? parseInt(m[1], 10) : 0;
}
