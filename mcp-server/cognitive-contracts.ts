// ScreenSync Cognitive Data Safety Contracts (AP-CE Tier 1)
// Inspired by accidental_data_loss_prevention & data_autocleaning
// Prevents agents from accidentally destroying unsubmitted form inputs, cart checkouts, or drafts.

export interface DirtyField {
  selector: string;
  tag: string;
  charCount: number;
  previewText?: string;
}

export interface EphemeralSnapshot {
  id: string;
  domain: string;
  url: string;
  timestamp: string;
  fields: DirtyField[];
}

export interface ContractCheckResult {
  safe: boolean;
  domain: string;
  dirtyCount: number;
  dirtyFields: DirtyField[];
  snapshotId?: string;
  actionRecommended: "allow" | "snapshot_and_proceed" | "block_and_confirm";
  warning?: string;
}

export class CognitiveContractEngine {
  private vault: Map<string, EphemeralSnapshot> = new Map();

  /**
   * Evaluates active page input state against data safety contract.
   * If dirty form elements are present, auto-creates an ephemeral recovery snapshot.
   */
  public evaluateFormContract(params: {
    domain: string;
    url: string;
    detectedDirtyFields?: DirtyField[];
    allowDirtyNavigation?: boolean;
  }): ContractCheckResult {
    const { domain, url, detectedDirtyFields = [], allowDirtyNavigation = false } = params;
    const dirtyCount = detectedDirtyFields.length;

    if (dirtyCount === 0) {
      return {
        safe: true,
        domain,
        dirtyCount: 0,
        dirtyFields: [],
        actionRecommended: "allow"
      };
    }

    // Auto-create ephemeral recovery snapshot
    const snapshotId = `snap_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const snapshot: EphemeralSnapshot = {
      id: snapshotId,
      domain,
      url,
      timestamp: new Date().toISOString(),
      fields: detectedDirtyFields
    };
    this.vault.set(snapshotId, snapshot);

    // Clean old snapshots (> 1 hour)
    if (this.vault.size > 100) {
      const oldestKey = this.vault.keys().next().value;
      if (oldestKey) this.vault.delete(oldestKey);
    }

    const safe = allowDirtyNavigation;
    const actionRecommended = allowDirtyNavigation ? "snapshot_and_proceed" : "block_and_confirm";

    return {
      safe,
      domain,
      dirtyCount,
      dirtyFields: detectedDirtyFields,
      snapshotId,
      actionRecommended,
      warning: `[DataLossGuard] ${dirtyCount} unsaved input field(s) detected. Ephemeral snapshot saved as ${snapshotId}.`
    };
  }

  public getSnapshot(snapshotId: string): EphemeralSnapshot | undefined {
    return this.vault.get(snapshotId);
  }

  public clear(): void {
    this.vault.clear();
  }
}

export const globalContractEngine = new CognitiveContractEngine();
