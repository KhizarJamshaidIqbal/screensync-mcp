// ScreenSync Extension Hippocampal Consolidation (AP-CE Tier 4 Client Parity)
// Compaction and LTP/LTD tiering for chrome.storage.local

const BRONZE_MAX_EPISODES = 50;

export async function consolidateClientMemory(memoryData) {
  if (!memoryData) return { pruned: 0, retained: 0 };

  const episodes = memoryData.episodes || [];
  let pruned = 0;

  if (episodes.length > BRONZE_MAX_EPISODES) {
    pruned = episodes.length - BRONZE_MAX_EPISODES;
    memoryData.episodes = episodes.slice(-BRONZE_MAX_EPISODES);
  }

  // Strengthen playbooks with successful runs
  const playbooks = memoryData.playbooks || {};
  for (const pb of Object.values(playbooks)) {
    if (pb.successCount && pb.successCount > 0) {
      pb.confidenceScore = Math.min(1.0, (pb.confidenceScore || 0.8) + 0.05);
    }
  }

  memoryData.lastConsolidatedAt = new Date().toISOString();
  return {
    pruned,
    retained: (memoryData.episodes || []).length,
    strengthened: Object.keys(playbooks)
  };
}
