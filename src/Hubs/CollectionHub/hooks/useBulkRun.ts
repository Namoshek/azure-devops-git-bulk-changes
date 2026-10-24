import { useCallback, useRef, useState } from "react";
import { applyRepos, previewRepos } from "../../../services/bulkChanges/runner";
import { createRepoAccess } from "../../../infrastructure/azureDevOps/repoClient";
import { ApplyResult, BulkChangeDefinition, RepoPlan, RepoTarget } from "../../../domain/bulkChanges/types";
import { recordBulkChangeHistory } from "../../../services/bulkChanges/history";
import { getErrorMessage } from "../../../utils/errorUtils";

export type RunPhase = "idle" | "previewing" | "previewed" | "applying" | "applied";

/** Identifies exactly what a preview was computed for. */
export interface PreviewStamp {
  /** `definitionKeyOf(definition)` for the definition that produced the plans. */
  definitionKey: string;
  /** Sorted repository ids of the targets that produced the plans. */
  targetIds: string[];
}

export interface BulkRunState {
  phase: RunPhase;
  plans: RepoPlan[];
  results: ApplyResult[];
  error: string | null;
  /** True while a preview or an apply is in flight. */
  busy: boolean;
  /** How many of the current run's repositories are settled. */
  done: number;
  total: number;
  /** `null` until a preview has completed; callers compare it against the current inputs. */
  stamp: PreviewStamp | null;
  startPreview: (definition: BulkChangeDefinition, targets: RepoTarget[]) => void;
  startApply: (definition: BulkChangeDefinition, plans: RepoPlan[], yamlText: string) => void;
  cancel: () => void;
  reset: () => void;
}

const CONCURRENCY = 4;

/**
 * Owns the preview/apply lifecycle: progress and cancellation.
 *
 * A completed preview is stamped with the definition and target ids that produced it; the caller
 * compares the stamp with its current inputs to decide whether applying is still safe.
 */
export function useBulkRun(): BulkRunState {
  const [phase, setPhase] = useState<RunPhase>("idle");
  const [plans, setPlans] = useState<RepoPlan[]>([]);
  const [results, setResults] = useState<ApplyResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [stamp, setStamp] = useState<PreviewStamp | null>(null);

  const cancelled = useRef(false);
  const running = useRef(false);

  const startPreview = useCallback((definition: BulkChangeDefinition, targets: RepoTarget[]): void => {
    if (running.current) {
      return;
    }
    running.current = true;
    cancelled.current = false;
    setPhase("previewing");
    setPlans([]);
    setResults([]);
    setError(null);
    setDone(0);
    setTotal(targets.length);

    void previewRepos(createRepoAccess(), definition, targets, {
      concurrency: CONCURRENCY,
      isCancelled: () => cancelled.current,
      onProgress: (partial) => setPlans(partial as RepoPlan[]),
    })
      .then((settled) => {
        setPlans(settled);
        setDone(settled.length);
        setStamp({
          definitionKey: definitionKeyOf(definition),
          targetIds: targets.map((target) => target.repositoryId).sort(),
        });
        setPhase("previewed");
      })
      .catch((err) => {
        setError(getErrorMessage(err));
        setPhase("idle");
      })
      .finally(() => {
        running.current = false;
      });
  }, []);

  const startApply = useCallback((definition: BulkChangeDefinition, previewed: RepoPlan[], yamlText: string): void => {
    if (running.current) {
      return;
    }
    running.current = true;
    cancelled.current = false;
    setPhase("applying");
    setResults([]);
    setError(null);
    setDone(0);
    setTotal(previewed.length);

    void applyRepos(createRepoAccess(), definition, previewed, {
      concurrency: CONCURRENCY,
      isCancelled: () => cancelled.current,
      onProgress: (partial) => setResults(partial as ApplyResult[]),
    })
      .then(async (settled) => {
        setResults(settled);
        setDone(settled.length);
        try {
          await recordBulkChangeHistory(yamlText, settled);
        } catch (err) {
          console.warn("Failed to record bulk change history:", err);
        }
        setPhase("applied");
      })
      .catch((err) => {
        setError(getErrorMessage(err));
        setPhase("previewed");
      })
      .finally(() => {
        running.current = false;
      });
  }, []);

  const cancel = useCallback((): void => {
    cancelled.current = true;
  }, []);

  const reset = useCallback((): void => {
    cancelled.current = true;
    running.current = false;
    setPhase("idle");
    setPlans([]);
    setResults([]);
    setError(null);
    setDone(0);
    setTotal(0);
    setStamp(null);
  }, []);

  // Derived from the phase, so a state change always re-renders with the right value.
  const busy = phase === "previewing" || phase === "applying";

  return { phase, plans, results, error, busy, done, total, stamp, startPreview, startApply, cancel, reset };
}

/**
 * Stable key for a definition, used only to detect edits: two identical definitions always produce
 * the same string. Derived from the normalized model rather than the raw editor text.
 */
export function definitionKeyOf(definition: BulkChangeDefinition): string {
  return JSON.stringify(definition);
}

/** True when `stamp` still describes the given definition and targets, so its plans may be applied. */
export function isPreviewCurrent(stamp: PreviewStamp | null, definitionKey: string, targetIds: string[]): boolean {
  if (!stamp) {
    return false;
  }
  return stamp.definitionKey === definitionKey && stamp.targetIds.join("\n") === [...targetIds].sort().join("\n");
}
