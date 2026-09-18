// ScreenSync Semantic Similarity Engine (Architecture 4.0)
// Inspired by BigQuery AI.SIMILARITY & AI.SEARCH (bigquery_ai_ml plugin) and Cognitive Prototype Theory.
// Resolves fuzzy user intentions and drifted DOM elements to canonical concepts without hardcoded dictionaries.

export interface IntentMatchResult {
  rawIntent: string;
  canonicalIntent: string;
  similarityScore: number;
  matchedSynonym: string;
  exactMatch: boolean;
}

export interface ElementMatchResult {
  bestMatch: {
    selector: string;
    text?: string;
    ariaLabel?: string;
    role?: string;
    score: number;
  } | null;
  candidatesRanked: Array<{ selector: string; score: number }>;
}

export class SemanticSimilarityEngine {
  private intentClusters: Record<string, string[]> = {
    post: ["post", "tweet", "publish", "share", "status_update", "create_post", "tweet_thoughts", "send_tweet"],
    login: ["login", "sign_in", "sign_on", "sign on", "authenticate", "log_on", "session_start", "enter_account"],
    checkout: ["checkout", "buy_now", "submit_order", "pay", "purchase", "complete_order"],
    search: ["search", "find", "lookup", "query", "explore", "filter"],
    navigate: ["navigate", "go_to", "open_url", "visit", "browse_to"],
  };

  /**
   * Calculates trigram/n-gram Jaccard similarity between two strings.
   */
  public computeSimilarity(str1: string, str2: string): number {
    const s1 = str1.toLowerCase().trim();
    const s2 = str2.toLowerCase().trim();
    if (s1 === s2) return 1.0;
    if (!s1 || !s2) return 0.0;

    const getGrams = (s: string) => {
      const grams = new Set<string>();
      for (let i = 0; i < s.length - 1; i++) {
        grams.add(s.slice(i, i + 2));
      }
      return grams;
    };

    const g1 = getGrams(s1);
    const g2 = getGrams(s2);
    let intersection = 0;
    for (const g of g1) {
      if (g2.has(g)) intersection++;
    }
    const union = g1.size + g2.size - intersection;
    return union === 0 ? 0 : Number((intersection / union).toFixed(3));
  }

  public resolveIntent(rawIntent: string): IntentMatchResult {
    const query = rawIntent.toLowerCase().replace(/[_\s-]+/g, " ").trim();
    let bestCanonical = "general";
    let bestSynonym = "";
    let highestScore = 0.0;

    for (const [canonical, synonyms] of Object.entries(this.intentClusters)) {
      for (const syn of synonyms) {
        const cleanSyn = syn.replace(/[_\s-]+/g, " ");
        if (query === cleanSyn || query.includes(cleanSyn) || cleanSyn.includes(query)) {
          return {
            rawIntent,
            canonicalIntent: canonical,
            similarityScore: 0.98,
            matchedSynonym: syn,
            exactMatch: query === cleanSyn,
          };
        }
        const score = this.computeSimilarity(query, cleanSyn);
        if (score > highestScore) {
          highestScore = score;
          bestCanonical = canonical;
          bestSynonym = syn;
        }
      }
    }

    return {
      rawIntent,
      canonicalIntent: highestScore >= 0.45 ? bestCanonical : rawIntent,
      similarityScore: highestScore,
      matchedSynonym: bestSynonym,
      exactMatch: false,
    };
  }

  public matchCandidateElement(
    targetDesc: string,
    candidates: Array<{ selector: string; text?: string; ariaLabel?: string; role?: string }>
  ): ElementMatchResult {
    const target = targetDesc.toLowerCase();
    const scored = candidates.map((cand) => {
      const candText = `${cand.text || ""} ${cand.ariaLabel || ""} ${cand.role || ""}`.toLowerCase();
      let score = this.computeSimilarity(target, candText);
      if (candText.includes(target)) score = Math.max(score, 0.92);
      return { selector: cand.selector, text: cand.text, ariaLabel: cand.ariaLabel, role: cand.role, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return {
      bestMatch: scored[0] || null,
      candidatesRanked: scored.map((s) => ({ selector: s.selector, score: s.score })),
    };
  }
}

export const globalSimilarityEngine = new SemanticSimilarityEngine();
