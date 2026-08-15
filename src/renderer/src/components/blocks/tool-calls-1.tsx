"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type RefObject,
} from "react";
import { motion, useReducedMotion } from "motion/react";
import { ChevronRight, Square, ArrowDown } from "lucide-react";

const cx = (...c: (string | false | null | undefined)[]) =>
  c.filter(Boolean).join(" ");

function useScrollFade<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    setEdges({
      start: scrollTop > 1,
      end: Math.ceil(scrollTop + clientHeight) < scrollHeight - 1,
    });
  }, []);

  useEffect(() => {
    update();
    const el = ref.current;
    const view = el?.ownerDocument.defaultView;
    if (!el || !view?.ResizeObserver) return;
    const observer = new view.ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [update]);

  return { ref, edges, onScroll: update };
}

type Status = "streaming" | "running" | "done" | "failed";

type ToolCall = {
  id: string;
  name: string;
  status: Status;
  input?: string;
  output?: string;
  startedAt?: string;
  duration?: string;
};

const STREAMING_INPUT = `{
  "workspace": "northstar-prod",
  "query": "open incidents touching checkout latency",
  "include": ["timeline", "owners", "recent_deploys"],
  "window": "last 24h",
  "limit": 5
}`;

const DONE_RESULT = `{
  "incidents": [
    {
      "id": "INC-2487",
      "service": "checkout-api",
      "owner": "Payments Platform",
      "status": "mitigated",
      "startedAt": "10:42 UTC",
      "summary": "p95 latency rose after retry backoff was lowered"
    },
    {
      "id": "INC-2485",
      "service": "cart-sync",
      "owner": "Storefront Reliability",
      "status": "watching",
      "summary": "queue depth normalized after a worker pool resize"
    }
  ],
  "count": 2
}`;

const SETTLED: ToolCall[] = [
  {
    id: "call_a1",
    name: "read_file",
    status: "done",
    duration: "38ms",
    startedAt: "14:08:22.041",
    input: `{ "path": "services/payments/retry.ts" }`,
    output: `120 lines · exported withRetry, isRetryable, RetryError`,
  },
  {
    id: "call_a2",
    name: "grep",
    status: "done",
    duration: "112ms",
    startedAt: "14:08:24.900",
    input: `{ "pattern": "RETRY_BACKOFF_MS", "path": "services" }`,
    output: `3 matches across 2 files`,
  },
  {
    id: "call_a3",
    name: "list_dir",
    status: "done",
    duration: "12ms",
    startedAt: "14:08:25.204",
    input: `{ "path": "services/checkout" }`,
    output: `9 entries · latency.ts, handler.ts, __tests__/`,
  },
  {
    id: "call_a4",
    name: "read_file",
    status: "done",
    duration: "41ms",
    startedAt: "14:08:25.660",
    input: `{ "path": "services/checkout/latency.ts" }`,
    output: `88 lines · p95 timer wraps the retry path`,
  },
  {
    id: "call_a5",
    name: "run_tests",
    status: "failed",
    duration: "2.30s",
    startedAt: "14:08:26.010",
    input: `{ "suite": "checkout", "grep": "retry" }`,
    output: `1 failing · backoff ceiling exceeded under sustained load`,
  },
  {
    id: "call_a6",
    name: "read_deploys",
    status: "done",
    duration: "88ms",
    startedAt: "14:08:28.400",
    input: `{ "service": "checkout-api", "window": "24h" }`,
    output: `2 deploys · retry backoff lowered at 10:31 UTC`,
  },
  {
    id: "call_a7",
    name: "git_blame",
    status: "done",
    duration: "64ms",
    startedAt: "14:08:29.020",
    input: `{ "path": "services/payments/retry.ts", "line": 88 }`,
    output: `changed by a.rivera in 4f2c1de · "tune backoff"`,
  },
  {
    id: "call_a8",
    name: "fetch_dashboard",
    status: "done",
    duration: "210ms",
    startedAt: "14:08:29.310",
    input: `{ "panel": "p95-latency", "service": "checkout-api" }`,
    output: `p95 780ms → 1.42s starting 10:42 UTC`,
  },
  {
    id: "call_a9",
    name: "read_config",
    status: "done",
    duration: "22ms",
    startedAt: "14:08:29.410",
    input: `{ "path": "services/payments/retry.config.json" }`,
    output: `backoff ceiling 800ms · maxRetries 4`,
  },
  {
    id: "call_a10",
    name: "query_logs",
    status: "done",
    duration: "173ms",
    startedAt: "14:08:29.490",
    input: `{ "service": "checkout-api", "level": "error", "window": "1h" }`,
    output: `41 errors · 38 RetryError, 3 timeouts`,
  },
  {
    id: "call_a11",
    name: "list_owners",
    status: "running",
    startedAt: "14:08:29.610",
    input: `{ "service": "checkout-api" }`,
  },
];

const STREAMING_CALL: ToolCall = {
  id: "call_live",
  name: "search_incidents",
  status: "streaming",
  startedAt: "14:08:30.118",
};

const LIVE_DURATION = "1.46s";

const CATCH_UP_MS = 180;
const FLOOR_CPS = 45;

function lastWordBoundary(source: string, cut: number) {
  if (cut >= source.length) return source.length;
  const i = source.lastIndexOf(" ", cut);
  return i === -1 ? 0 : i;
}

function useSmoothedText(): {
  text: string;
  done: boolean;
  push: (chunk: string) => void;
  end: () => void;
  reset: () => void;
} {
  const [text, setText] = useState("");
  const [done, setDone] = useState(false);
  const targetRef = useRef("");
  const shownRef = useRef(0);
  const endedRef = useRef(false);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    let raf = 0;
    let last = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(now - last, 64);
      last = now;

      const target = targetRef.current;
      const behind = target.length - shownRef.current;

      if (behind > 0) {
        shownRef.current = reduceMotion
          ? target.length
          : Math.min(
              target.length,
              shownRef.current +
                behind * (1 - Math.exp(-dt / CATCH_UP_MS)) +
                (FLOOR_CPS * dt) / 1000,
            );

        const cut = Math.floor(shownRef.current);
        const finished = endedRef.current && cut >= target.length;
        const safe = finished ? target.length : lastWordBoundary(target, cut);
        setText(target.slice(0, safe));
        if (finished) setDone(true);
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduceMotion]);

  return {
    text,
    done,
    push: useCallback((chunk: string) => {
      targetRef.current += chunk;
    }, []),
    end: useCallback(() => {
      endedRef.current = true;
    }, []),
    reset: useCallback(() => {
      targetRef.current = "";
      shownRef.current = 0;
      endedRef.current = false;
      setText("");
      setDone(false);
    }, []),
  };
}

function useStickToBottom(scrollRef: RefObject<HTMLDivElement | null>) {
  const stickRef = useRef(true);
  const [showJump, setShowJump] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const sync = () => {
      const overflowing = el.scrollHeight - el.clientHeight > 1;
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      const atBottom = !overflowing || distance < 24;
      stickRef.current = atBottom;
      setShowJump(overflowing && !atBottom);
    };

    const onIntent = (e: WheelEvent | TouchEvent) => {
      const up = "deltaY" in e ? e.deltaY < 0 : true;
      if (!up) return;
      if (el.scrollHeight - el.clientHeight > 1 && el.scrollTop > 0) {
        stickRef.current = false;
      }
    };

    const observer = new ResizeObserver(() => {
      if (stickRef.current) el.scrollTop = el.scrollHeight;
      sync();
    });
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);

    el.addEventListener("wheel", onIntent, { passive: true });
    el.addEventListener("touchmove", onIntent, { passive: true });
    el.addEventListener("scroll", sync, { passive: true });

    el.scrollTop = el.scrollHeight;
    sync();
    return () => {
      observer.disconnect();
      el.removeEventListener("wheel", onIntent);
      el.removeEventListener("touchmove", onIntent);
      el.removeEventListener("scroll", sync);
    };
  }, []);

  const jump = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = true;
    setShowJump(false);
    el.scrollTop = el.scrollHeight;
  }, []);

  return { showJump, jump };
}

const STATUS_WORD: Record<Status, string> = {
  streaming: "Streaming",
  running: "Running",
  done: "Done",
  failed: "Failed",
};

function Dot({ status }: { status: Status }) {
  const active = status === "streaming" || status === "running";
  return (
    <span
      aria-hidden="true"
      className={cx(
        "h-1.5 w-1.5 shrink-0 rounded-full",
        status === "done" && "bg-neutral-300 dark:bg-neutral-600",
        status === "failed" && "bg-red-500",
        active &&
          "animate-pulse bg-neutral-400 motion-reduce:animate-none dark:bg-neutral-500",
      )}
    />
  );
}

function Missing() {
  return (
    <span className="text-neutral-400 dark:text-neutral-600">&mdash;</span>
  );
}

function Field({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex items-center gap-2">
      <dt className="text-neutral-500 dark:text-neutral-500">{label}</dt>
      <dd className="font-mono tabular-nums text-neutral-700 dark:text-neutral-300">
        {value ?? <Missing />}
      </dd>
    </div>
  );
}

export default function ToolCalls1() {
  const uid = useId();
  const [liveStatus, setLiveStatus] = useState<Status>("streaming");
  const [openId, setOpenId] = useState<string>("call_live");
  const { text, done, push, end } = useSmoothedText();
  const transcript = useScrollFade<HTMLDivElement>();
  const { showJump, jump } = useStickToBottom(transcript.ref);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (reduceMotion) {
      push(STREAMING_INPUT);
      end();
      return;
    }
    let i = 0;
    let timer: ReturnType<typeof setTimeout>;
    const feed = () => {
      if (i >= STREAMING_INPUT.length) {
        end();
        return;
      }
      const size = 3 + Math.floor(Math.random() * 8);
      push(STREAMING_INPUT.slice(i, i + size));
      i += size;
      timer = setTimeout(feed, 40 + Math.random() * 90);
    };
    timer = setTimeout(feed, 260);
    return () => clearTimeout(timer);
  }, [push, end, reduceMotion]);

  useEffect(() => {
    if (!done) return;
    const toRunning = setTimeout(() => setLiveStatus("running"), 0);
    const toOutput = setTimeout(() => setLiveStatus("done"), 700);
    return () => {
      clearTimeout(toRunning);
      clearTimeout(toOutput);
    };
  }, [done]);

  const stop = useCallback(() => {
    end();
    setLiveStatus("done");
  }, [end]);

  const live: ToolCall = {
    ...STREAMING_CALL,
    status: liveStatus,
    input: liveStatus === "streaming" ? text : STREAMING_INPUT,
    output: liveStatus === "done" ? DONE_RESULT : undefined,
    duration: liveStatus === "done" ? LIVE_DURATION : undefined,
  };
  const calls: ToolCall[] = [...SETTLED, live];
  const busy = liveStatus !== "done";

  return (
    <div className="relative flex h-full min-h-[640px] w-full flex-col overflow-hidden bg-white p-4 sm:p-6 dark:bg-neutral-950">
      <header className="mb-3 flex shrink-0 items-center justify-between gap-3">
        <h2 className="text-base font-medium tracking-[-0.01em] text-neutral-900 dark:text-neutral-100">
          Tool calls
        </h2>
        {busy ? (
          <button
            type="button"
            onClick={stop}
            className="inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-[var(--rb-r-md,8px)] bg-neutral-100 px-2.5 text-[13px] font-medium text-neutral-700 transition-[transform,background-color,color] duration-150 ease-out hover:bg-neutral-200 active:scale-[0.97] focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rb-accent,oklch(20.5%_0_0))] dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700 dark:focus-visible:outline-[var(--rb-accent,oklch(100%_0_0))]"
          >
            <Square aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
            Stop
          </button>
        ) : (
          <span className="text-xs tabular-nums text-neutral-500 dark:text-neutral-500">
            {calls.length} calls
          </span>
        )}
      </header>

      <div className="relative min-h-0 flex-1 rounded-[var(--rb-r-2xl,14px)] border border-neutral-200/70 bg-neutral-50 p-1 dark:border-neutral-800 dark:bg-neutral-900">
        <div
          ref={transcript.ref}
          onScroll={transcript.onScroll}
          className="h-full space-y-1 overflow-y-auto overscroll-contain rounded-[var(--rb-r-lg,10px)] [overflow-anchor:none]"
        >
          {calls.map((p) => {
            const open = openId === p.id;
            const streaming = p.status === "streaming";
            const hasInput = Boolean(p.input);
            const hasOutput = Boolean(p.output);
            const panelId = `${uid}-${p.id}`;
            const header = (
              <button
                type="button"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => setOpenId(open ? "" : p.id)}
                className={cx(
                  "flex h-10 w-full cursor-pointer items-center gap-2 px-2 text-left transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--rb-accent,oklch(20.5%_0_0))] dark:focus-visible:outline-[var(--rb-accent,oklch(100%_0_0))]",
                  open
                    ? "rounded-t-[var(--rb-r-md,8px)] hover:bg-neutral-50 dark:hover:bg-neutral-900"
                    : "rounded-[var(--rb-r-lg,10px)] border border-neutral-200/70 bg-white hover:bg-neutral-50 active:bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-950 dark:hover:bg-neutral-900 dark:active:bg-neutral-800/70",
                )}
              >
                <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--rb-r-sm,6px)] bg-neutral-100 dark:bg-neutral-800">
                  <ChevronRight
                    aria-hidden="true"
                    className={cx(
                      "h-3.5 w-3.5 text-neutral-500 transition-transform duration-150 ease-out dark:text-neutral-500",
                      open && "rotate-90",
                    )}
                  />
                </span>
                <span className="shrink-0 font-mono text-xs text-neutral-900 dark:text-neutral-100">
                  {p.name}
                </span>
                <span className="ml-auto shrink-0 text-xs tabular-nums text-neutral-500 dark:text-neutral-500">
                  {p.duration ?? <Missing />}
                </span>
                <span className="flex w-24 shrink-0 items-center justify-end gap-1.5">
                  <Dot status={p.status} />
                  <span className="text-[13px] text-neutral-600 dark:text-neutral-400">
                    {STATUS_WORD[p.status]}
                  </span>
                </span>
              </button>
            );
            return open ? (
              <div
                key={p.id}
                className="overflow-hidden rounded-[var(--rb-r-lg,10px)] border border-neutral-200/70 bg-white dark:border-neutral-800 dark:bg-neutral-950"
              >
                {header}
                <div id={panelId} className="space-y-3 px-3 pb-3 pt-1">
                  <dl className="flex flex-wrap gap-x-8 gap-y-1 text-xs">
                    <Field label="Started" value={p.startedAt} />
                    <Field label="Duration" value={p.duration} />
                  </dl>

                  {hasInput && (
                    <div>
                      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-500">
                        Arguments
                      </p>
                      <pre className="max-h-40 overflow-auto whitespace-pre rounded-[var(--rb-r-sm,6px)] bg-neutral-50 p-3 font-mono text-xs leading-relaxed text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
                        {p.input ?? ""}
                        {streaming && !reduceMotion && (
                          <span
                            aria-hidden="true"
                            className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[0.15em] animate-pulse rounded-full bg-[var(--rb-accent,oklch(20.5%_0_0))] align-baseline motion-reduce:animate-none dark:bg-[var(--rb-accent,oklch(100%_0_0))]"
                          />
                        )}
                      </pre>
                    </div>
                  )}

                  {hasOutput && (
                    <div>
                      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-500">
                        Result
                      </p>
                      <pre className="max-h-40 overflow-auto whitespace-pre rounded-[var(--rb-r-sm,6px)] bg-neutral-50 p-3 font-mono text-xs leading-relaxed text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
                        {p.output}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div key={p.id}>{header}</div>
            );
          })}
        </div>

        <div
          aria-hidden="true"
          className={cx(
            "pointer-events-none absolute inset-x-1 top-1 h-8 rounded-t-[var(--rb-r-lg,10px)] bg-gradient-to-b from-neutral-50 to-transparent transition-opacity duration-200 ease-out dark:from-neutral-900",
            transcript.edges.start ? "opacity-100" : "opacity-0",
          )}
        />
        <div
          aria-hidden="true"
          className={cx(
            "pointer-events-none absolute inset-x-1 bottom-1 h-8 rounded-b-[var(--rb-r-lg,10px)] bg-gradient-to-t from-neutral-50 to-transparent transition-opacity duration-200 ease-out dark:from-neutral-900",
            transcript.edges.end ? "opacity-100" : "opacity-0",
          )}
        />
      </div>

      {showJump && (
        <motion.button
          type="button"
          onClick={jump}
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.15, ease: [0.23, 1, 0.32, 1] }}
          className="absolute bottom-5 left-1/2 inline-flex h-8 -translate-x-1/2 cursor-pointer items-center gap-1.5 rounded-[var(--rb-r-md,8px)] border border-neutral-200 bg-white/90 px-3 text-[13px] font-medium text-neutral-700 shadow-[0_4px_16px_-4px_rgba(0,0,0,0.10)] backdrop-blur transition-colors duration-150 ease-out hover:bg-neutral-100 focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rb-accent,oklch(20.5%_0_0))] dark:border-neutral-800 dark:bg-neutral-900/90 dark:text-neutral-300 dark:shadow-none dark:hover:bg-neutral-800 dark:focus-visible:outline-[var(--rb-accent,oklch(100%_0_0))]"
        >
          <ArrowDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
          Jump to latest
        </motion.button>
      )}
    </div>
  );
}
