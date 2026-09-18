import { rawAttach, rawDetach } from './web-adv-core.js';

// In-memory store for captured long screenshots
const longScreenshotStore = new Map(); // captureId -> { tiles, metadata, createdAt }
const MAX_CAPTURES = 5; // evict oldest if exceeded
const MAX_HEIGHT = 100000; // px
const STALE_MS = 300000; // 5 min auto-cleanup

/**
 * Capture a full-page screenshot using tiled scrolling.
 * Handles pages taller than Chrome's 16,384px CDP limit.
 */
export async function captureLongScreenshot(tab, args = {}) {
  const target = { tabId: tab.id };
  const format = args.format === 'png' ? 'png' : 'jpeg';
  const quality = typeof args.quality === 'number' ? Math.min(100, Math.max(1, args.quality)) : 80;
  const maxHeight = Math.min(Number(args.maxHeight) || MAX_HEIGHT, MAX_HEIGHT);
  
  let attached = false;
  try {
    await rawAttach(target); attached = true;
  } catch (e) {
    if (String((e && e.message) || e).includes('Already attached')) attached = true;
    else return { ok: false, error: `CDP attach failed: ${String((e && e.message) || e)}` };
  }

  try {
    await chrome.debugger.sendCommand(target, 'Page.enable', {});
    await chrome.debugger.sendCommand(target, 'Runtime.enable', {});
    
    // 1. Get page dimensions
    const metrics = await chrome.debugger.sendCommand(target, 'Page.getLayoutMetrics', {});
    const contentHeight = Math.min(metrics.cssContentSize?.height || metrics.contentSize?.height || 0, maxHeight);
    const viewportWidth = metrics.cssVisualViewport?.clientWidth || metrics.visualViewport?.clientWidth || 1920;
    const viewportHeight = metrics.cssVisualViewport?.clientHeight || metrics.visualViewport?.clientHeight || 1080;
    
    if (contentHeight <= viewportHeight) {
      // Page fits in one viewport — just do a regular screenshot
      const res = await chrome.debugger.sendCommand(target, 'Page.captureScreenshot', { 
        format, ...(format === 'jpeg' ? { quality } : {}), captureBeyondViewport: false 
      });
      return { 
        ok: true, 
        data: { 
          imageDataUrl: `data:image/${format};base64,${res.data}`, 
          fullPage: true, 
          tiled: false, 
          format, 
          totalHeight: contentHeight, 
          url: tab.url, 
          title: tab.title 
        } 
      };
    }
    
    // 2. Detect sticky/fixed headers
    //    Execute in page context to find position:fixed/sticky elements at top
    const stickyResult = await chrome.debugger.sendCommand(target, 'Runtime.evaluate', {
      expression: `(function() {
        const els = document.querySelectorAll('*');
        let stickyHeight = 0;
        for (const el of els) {
          const cs = window.getComputedStyle(el);
          if ((cs.position === 'fixed' || cs.position === 'sticky') && el.getBoundingClientRect().top < 10) {
            stickyHeight = Math.max(stickyHeight, el.getBoundingClientRect().height);
          }
        }
        return stickyHeight;
      })()`,
      returnByValue: true
    });
    const stickyHeaderHeight = stickyResult.result?.value || 0;
    
    // 3. Save original scroll position
    const origScroll = await chrome.debugger.sendCommand(target, 'Runtime.evaluate', {
      expression: '({ x: window.scrollX, y: window.scrollY })',
      returnByValue: true
    });
    const origScrollPos = origScroll.result?.value || { x: 0, y: 0 };
    
    // 4. Scroll to top
    await chrome.debugger.sendCommand(target, 'Runtime.evaluate', {
      expression: 'window.scrollTo(0, 0)',
      returnByValue: true
    });
    await sleep(100);
    
    // 5. Capture tiles by scrolling
    const tiles = [];
    const step = viewportHeight - stickyHeaderHeight;
    let lastScrollY = -1;
    let stallCount = 0;
    
    for (let scrollY = 0; scrollY < contentHeight; scrollY += step) {
      // Scroll to position
      await chrome.debugger.sendCommand(target, 'Runtime.evaluate', {
        expression: `window.scrollTo(0, ${scrollY})`,
        returnByValue: true
      });
      await sleep(150); // Wait for render
      
      // Check actual scroll position
      const actualScroll = await chrome.debugger.sendCommand(target, 'Runtime.evaluate', {
        expression: 'window.scrollY',
        returnByValue: true
      });
      const actualScrollY = actualScroll.result?.value || 0;
      
      // Stall detection
      if (actualScrollY === lastScrollY && scrollY > 0) {
        stallCount++;
        if (stallCount >= 2) break; // Page can't scroll further
      } else {
        stallCount = 0;
      }
      lastScrollY = actualScrollY;
      
      // Capture viewport tile
      const clip = { x: 0, y: 0, width: viewportWidth, height: viewportHeight, scale: 1 };
      // For tiles after the first, clip out the sticky header
      if (tiles.length > 0 && stickyHeaderHeight > 0) {
        clip.y = stickyHeaderHeight;
        clip.height = viewportHeight - stickyHeaderHeight;
      }
      
      const res = await chrome.debugger.sendCommand(target, 'Page.captureScreenshot', {
        format, ...(format === 'jpeg' ? { quality } : {}), clip
      });
      
      tiles.push({
        data: res.data,
        scrollY: actualScrollY,
        clipY: clip.y,
        clipHeight: clip.height,
        width: viewportWidth
      });
      
      // Freshness check: if last 2 tiles are identical, stop
      if (tiles.length >= 2) {
        const curr = tiles[tiles.length - 1].data;
        const prev = tiles[tiles.length - 2].data;
        if (curr.length === prev.length && curr.slice(0, 200) === prev.slice(0, 200)) break;
      }
    }
    
    // 6. Restore original scroll position
    await chrome.debugger.sendCommand(target, 'Runtime.evaluate', {
      expression: `window.scrollTo(${origScrollPos.x}, ${origScrollPos.y})`,
      returnByValue: true
    });
    
    // 7. Assemble tiles using offscreen canvas
    //    Since we're in service worker (no DOM), we assemble by:
    //    - Calculating total stitched height
    //    - Storing tile data for chunked delivery
    const stitchedHeight = tiles.reduce((h, t) => h + t.clipHeight, 0);
    
    // Generate captureId and store
    const captureId = `longss_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    evictOldCaptures();
    longScreenshotStore.set(captureId, {
      tiles,
      metadata: { format, viewportWidth, stitchedHeight, stickyHeaderHeight, tileCount: tiles.length, url: tab.url, title: tab.title },
      createdAt: Date.now()
    });
    
    // If total is small enough, return first tile as preview
    const previewDataUrl = tiles.length > 0 ? `data:image/${format};base64,${tiles[0].data}` : null;
    
    return {
      ok: true,
      data: {
        captureId,
        tiled: true,
        tileCount: tiles.length,
        format,
        viewportWidth,
        totalHeight: stitchedHeight,
        stickyHeaderHeight,
        previewDataUrl,
        url: tab.url,
        title: tab.title,
        message: `Captured ${tiles.length} tiles. Use web_screenshot_read with captureId to retrieve tile data.`
      }
    };
  } catch (err) {
    return { ok: false, error: `Long screenshot error: ${String((err && err.message) || err)}` };
  } finally {
    if (attached) {
      try {
        await rawDetach(target);
      } catch {
        // Ignore detach errors
      }
    }
  }
}

/**
 * Read a tile from a captured long screenshot.
 */
export function readLongScreenshotTile(captureId, tileIndex = 0) {
  evictOldCaptures();
  
  const capture = longScreenshotStore.get(captureId);
  if (!capture) {
    return { ok: false, error: `Capture not found or expired: ${captureId}` };
  }
  
  const index = Number(tileIndex) || 0;
  if (index < 0 || index >= capture.tiles.length) {
    return { ok: false, error: `Invalid tile index ${index}. Total tiles: ${capture.tiles.length}` };
  }
  
  const tile = capture.tiles[index];
  
  return {
    ok: true,
    data: {
      captureId,
      tileIndex: index,
      totalTiles: capture.tiles.length,
      tileDataUrl: `data:image/${capture.metadata.format};base64,${tile.data}`,
      clipY: tile.clipY,
      clipHeight: tile.clipHeight,
      viewportWidth: tile.width,
      metadata: capture.metadata
    }
  };
}

// Helper: sleep
function sleep(ms) { 
  return new Promise(r => setTimeout(r, ms)); 
}

// Helper: evict old captures
function evictOldCaptures() {
  const now = Date.now();
  
  // Remove expired captures
  for (const [id, capture] of longScreenshotStore.entries()) {
    if (now - capture.createdAt > STALE_MS) {
      longScreenshotStore.delete(id);
    }
  }
  
  // Enforce max captures limit
  if (longScreenshotStore.size > MAX_CAPTURES) {
    const sortedEntries = Array.from(longScreenshotStore.entries())
      .sort((a, b) => a[1].createdAt - b[1].createdAt);
      
    const numToDelete = longScreenshotStore.size - MAX_CAPTURES;
    for (let i = 0; i < numToDelete; i++) {
      longScreenshotStore.delete(sortedEntries[i][0]);
    }
  }
}
