// web-capture-meta.ts: the text block an MCP agent reads beside a screenshot's image. It used to be a fixed
// {url, title, fullPage, selector}, so nothing the capture said about itself (via, activatedTab, and since
// 2026-09-29 degraded / warning / paintConfirmed / navigatedDuringCapture) ever reached an MCP agent.

import test from "node:test";
import assert from "node:assert/strict";
import { captureMetaText } from "../web-capture-meta.js";

test("a clean capture keeps the four original keys and their defaults", () => {
  assert.deepEqual(JSON.parse(captureMetaText(undefined)), { url: null, title: null, fullPage: false, selector: null });
  const clean = JSON.parse(captureMetaText({ imageDataUrl: "data:image/jpeg;base64,AA", url: "https://a.example/", title: "A", format: "jpeg", paintConfirmed: true }));
  assert.equal(clean.imageDataUrl, undefined, "the pixels travel in the image block, never twice");
  assert.deepEqual(clean, { url: "https://a.example/", title: "A", fullPage: false, selector: null, paintConfirmed: true, format: "jpeg" });
  assert.equal(JSON.parse(captureMetaText({ fullPage: true, selector: "footer" })).selector, "footer");
});

test("what the capture reported about itself reaches the agent", () => {
  const warning = "The tab navigated while it was being captured: ...";
  const out = JSON.parse(captureMetaText({
    url: "https://booking.example/checkout", title: "Checkout", format: "png", via: "cdp", activatedTab: true,
    paintConfirmed: false, degraded: true, warning,
    navigatedDuringCapture: { before: "https://tours.example/", after: "https://booking.example/checkout" },
    clip: { x: 1 }, // not a capture-truth key: not copied
  }));
  assert.equal(out.degraded, true);
  assert.equal(out.warning, warning);
  assert.equal(out.paintConfirmed, false);
  assert.deepEqual(out.navigatedDuringCapture, { before: "https://tours.example/", after: "https://booking.example/checkout" });
  assert.equal(out.via, "cdp");
  assert.equal(out.activatedTab, true);
  assert.equal(out.format, "png");
  assert.equal(out.clip, undefined);
  assert.deepEqual(Object.keys(out).slice(0, 6), ["url", "title", "fullPage", "selector", "degraded", "warning"], "the doubt is read right after what the image is");
});

test("a page whose paint could not be checked says so without being called doubtful", () => {
  const out = JSON.parse(captureMetaText({ url: "https://down.example/", title: "down.example", format: "jpeg", paintConfirmed: false, paintCheck: "unavailable" }));
  assert.equal(out.paintCheck, "unavailable", "the reason paintConfirmed is false reaches the agent");
  assert.equal(out.degraded, undefined);
});
