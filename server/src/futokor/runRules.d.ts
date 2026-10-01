// The shapes of runRules.js, for the client: it runs the same rules on the
// phone (see client/src/app/services/futokor.ts) - the file itself stays
// plain JavaScript, like the rest of the server.

export interface RuleCheckpoint {
  id: string;
  tagId: string;
  kind: 'startFinish' | 'checkpoint';
  label: string;
  order: number;
  distanceAlongM?: number | null;
  lat?: number | null;
  lng?: number | null;
}

export interface RuleCourse {
  checkpoints: RuleCheckpoint[];
  distanceM?: number | null;
  flagSpeedMps?: number;
  duplicateScanWindowSec?: number;
  maxRunDurationMin?: number;
}

export interface RuleScan {
  clientScanId: string;
  tagId: string | null;
  time: number; // ms
  action?: 'restart' | 'giveUp' | null;
  lat?: number | null;
  lng?: number | null;
  accuracyM?: number | null;
}

export interface RuleSplit {
  fromCheckpointId: string;
  toCheckpointId: string;
  ms: number;
  distanceM: number | null;
  speedMps: number | null;
  paceSecPerKm: number | null;
}

export type RunStatus = 'running' | 'finished' | 'gave_up' | 'abandoned' | 'expired';

export interface RuleRun {
  status: RunStatus;
  startedAt: number;
  scans: {
    clientScanId: string;
    tagId: string | null;
    checkpointId: string;
    role: 'start' | 'checkpoint' | 'finish';
    time: number;
    distanceAlongM: number | null;
    flags: string[];
  }[];
  passed: number;
  splits: RuleSplit[];
  flagged: boolean;
  finishedAt?: number;
  endedAt?: number;
  totalMs?: number;
  paceSecPerKm?: number | null;
}

export type ScanResult =
  | 'started'
  | 'passed'
  | 'finished'
  | 'gaveUp'
  | 'duplicate'
  | 'incomplete'
  | 'rejectedOrder'
  | 'rejectedSpeed'
  | 'noRun'
  | 'unknownTag';

export interface ScanOutcome {
  result: ScanResult;
  checkpoint?: RuleCheckpoint;
  missing?: RuleCheckpoint | null;
  split?: RuleSplit;
  speedMps?: number | null;
}

export const MAX_SPEED_MPS: number;
export const DEFAULTS: {
  flagSpeedMps: number;
  duplicateScanWindowSec: number;
  maxRunDurationMin: number;
};
export function nextCheckpoint(course: RuleCourse, run: RuleRun | null): RuleCheckpoint | null;
export function isExpired(course: RuleCourse, run: RuleRun | null, time: number): boolean;
export function applyScan(
  course: RuleCourse,
  run: RuleRun | null,
  scan: RuleScan,
): { run: RuleRun | null; closed: RuleRun | null; outcome: ScanOutcome };
export function replayScans(
  course: RuleCourse,
  scans: RuleScan[],
): {
  runs: RuleRun[];
  results: { clientScanId: string; result: ScanResult; runIndex: number | null }[];
};
