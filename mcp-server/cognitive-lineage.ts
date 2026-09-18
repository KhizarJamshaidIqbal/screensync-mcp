// ScreenSync Playbook DAG Lineage & Cryptographic Provenance (AP-CE Tier 2)
// Inspired by Dataform & dbt DAG Lineage models
// Tracks the evolutionary history of playbooks and selector mutations over time.

export interface LineageCommit {
  commitId: string;
  playbookId: string;
  parentCommitId: string | null;
  timestamp: string;
  author: "self_healing_engine" | "user_operator" | "consolidation_job" | "initial_seed";
  mutationReason: string;
  diffSummary: {
    modifiedStepIndex?: number;
    oldSelector?: string;
    newSelector?: string;
    deltaMs?: number;
  };
}

export class PlaybookLineageEngine {
  private commits: LineageCommit[] = [];

  constructor() {
    this.seedInitialLineage();
  }

  private seedInitialLineage(): void {
    this.commits.push({
      commitId: "c_init_x_post_v1",
      playbookId: "x_publish_post",
      parentCommitId: null,
      timestamp: "2026-09-18T10:43:12.000Z",
      author: "initial_seed",
      mutationReason: "Initial canonical verified playbook for X.com composition.",
      diffSummary: {
        modifiedStepIndex: 3,
        oldSelector: "div[data-testid='tweetTextarea_0']",
        newSelector: "div[data-testid='tweetTextarea_0']"
      }
    });
  }

  public recordMutation(params: {
    playbookId: string;
    author: LineageCommit["author"];
    mutationReason: string;
    diffSummary: LineageCommit["diffSummary"];
  }): LineageCommit {
    const parent = this.getLatestCommit(params.playbookId);
    const commitId = `c_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    const commit: LineageCommit = {
      commitId,
      playbookId: params.playbookId,
      parentCommitId: parent ? parent.commitId : null,
      timestamp: new Date().toISOString(),
      author: params.author,
      mutationReason: params.mutationReason,
      diffSummary: params.diffSummary
    };

    this.commits.push(commit);
    if (this.commits.length > 200) this.commits.shift();

    return commit;
  }

  public getLatestCommit(playbookId: string): LineageCommit | undefined {
    for (let i = this.commits.length - 1; i >= 0; i--) {
      if (this.commits[i].playbookId === playbookId) {
        return this.commits[i];
      }
    }
    return undefined;
  }

  public getHistory(playbookId?: string): LineageCommit[] {
    if (!playbookId) return [...this.commits];
    return this.commits.filter((c) => c.playbookId === playbookId);
  }
}

export const globalLineageEngine = new PlaybookLineageEngine();
