import { useEffect, useRef, useState } from "react";
import { summarizeSession, type RunResult, type Session, type SessionSummary } from "@cadence/core";

/** Mirrors @cadence/tracer-file's TraceEnvelope (that package is Node-only). */
export interface TraceEnvelope {
  version: 1;
  session: Session;
  result?: RunResult;
  writtenAt: number;
}

/**
 * A row of the traces listing. Summary fields are optional: a file that is
 * mid-write or malformed still lists, it just can't be described yet.
 */
export interface TraceFileInfo extends Partial<SessionSummary> {
  name: string;
  mtimeMs: number;
  size: number;
}

/** Poll the traces directory listing. */
export function useTraceList(pollMs = 2500): TraceFileInfo[] {
  const [files, setFiles] = useState<TraceFileInfo[]>([]);

  useEffect(() => {
    let alive = true;
    const tick = async (): Promise<void> => {
      try {
        const res = await fetch("/traces");
        if (!res.ok) return;
        const data = (await res.json()) as TraceFileInfo[];
        if (alive) setFiles(data);
      } catch {
        /* server briefly away — keep the last list */
      }
    };
    void tick();
    const id = setInterval(() => void tick(), pollMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [pollMs]);

  return files;
}

/**
 * Tail one trace file. Keeps the last good envelope across transient read
 * errors (mid-write, server restart) — a torn read self-heals on the next poll.
 */
export function useTrace(name: string, pollMs = 800): { envelope: TraceEnvelope | null; stale: boolean } {
  const [envelope, setEnvelope] = useState<TraceEnvelope | null>(null);
  const [stale, setStale] = useState(false);
  const lastWritten = useRef(0);

  useEffect(() => {
    setEnvelope(null);
    lastWritten.current = 0;
    let alive = true;

    const tick = async (): Promise<void> => {
      try {
        const res = await fetch(`/traces/${encodeURIComponent(name)}`);
        if (!res.ok) {
          if (alive) setStale(true);
          return;
        }
        const data = (await res.json()) as TraceEnvelope;
        if (!alive || data.version !== 1) return;
        if (data.writtenAt !== lastWritten.current) {
          lastWritten.current = data.writtenAt;
          setEnvelope(data);
        }
        setStale(false);
      } catch {
        if (alive) setStale(true);
      }
    };

    void tick();
    const id = setInterval(() => void tick(), pollMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [name, pollMs]);

  return { envelope, stale };
}

/**
 * Summarize every trace in the listing, for the Sessions view and the trace
 * picker's labels. Fetches each file once and re-fetches only when its mtime
 * changes, so polling costs nothing after the first pass — live.json included,
 * which re-reads once per turn while a run is going.
 */
export function useTraceSummaries(files: TraceFileInfo[]): Map<string, SessionSummary> {
  const [summaries, setSummaries] = useState<Map<string, SessionSummary>>(new Map());
  const cache = useRef(new Map<string, { mtimeMs: number; summary: SessionSummary }>());

  useEffect(() => {
    let alive = true;
    const stale = files.filter((f) => cache.current.get(f.name)?.mtimeMs !== f.mtimeMs);
    if (stale.length === 0) return;

    void (async () => {
      for (const f of stale) {
        try {
          const res = await fetch(`/traces/${encodeURIComponent(f.name)}`);
          if (!res.ok) continue;
          const data = (await res.json()) as TraceEnvelope;
          if (!alive || !data.session) continue;
          cache.current.set(f.name, {
            mtimeMs: f.mtimeMs,
            summary: summarizeSession(data.session, data.result),
          });
        } catch {
          /* mid-write or gone — the next listing poll retries */
        }
      }
      if (alive) {
        setSummaries(new Map([...cache.current].map(([name, v]) => [name, v.summary])));
      }
    })();

    return () => {
      alive = false;
    };
  }, [files]);

  return summaries;
}
