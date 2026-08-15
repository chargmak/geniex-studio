"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
} from "react";
import {
  ArrowUp,
  BookOpen,
  Check,
  ChevronDown,
  Code,
  FileText,
  FlaskConical,
  Mic,
  Paperclip,
  Square,
  Wrench,
  X,
} from "lucide-react";

const cx = (...c: (string | false | null | undefined)[]) =>
  c.filter(Boolean).join(" ");

const EFFORTS = ["Low", "Medium", "High"];

function EffortGauge({ level }: { level: number }) {
  const fraction = level / (EFFORTS.length - 1);
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className="h-4.5 w-4.5 shrink-0"
    >
      <path
        d="M5.94 16.5A7 7 0 1 1 18.06 16.5"
        pathLength={100}
        className="stroke-current opacity-30"
        strokeWidth={2}
        strokeLinecap="round"
      />
      <path
        d="M5.94 16.5A7 7 0 1 1 18.06 16.5"
        pathLength={100}
        strokeDasharray={`${Math.max(fraction * 100, 0.01)} 100`}
        className="stroke-current"
        strokeWidth={2}
        strokeLinecap="round"
      />
      <line
        x1="12"
        y1="13"
        x2="12"
        y2="7.5"
        className="origin-[12px_13px] stroke-current transition-transform duration-[220ms] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none"
        style={{ transform: `rotate(${(fraction - 0.5) * 240}deg)` }}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <circle cx="12" cy="13" r="1.25" className="fill-current" />
    </svg>
  );
}

const TRACK_PAD = 8;
const FILL_PX = 32;
const THUMB_PX = 24;
const THUMB_INSET = (FILL_PX - THUMB_PX) / 2;

const EFFORT_EXIT_MS = 120;

const EFFORT_SETTLE_MS = 180;

const MENU_GUTTER = 16;
const MENU_MIN_H = 96;

function EffortSlider({
  level,
  onChange,
}: {
  level: number;
  onChange: (next: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [travel, setTravel] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    const el = trackRef.current;
    if (el) setTravel(Math.max(el.clientWidth - TRACK_PAD * 2 - FILL_PX, 0));
  }, []);

  useEffect(() => {
    const el = trackRef.current;
    const view = el?.ownerDocument.defaultView;
    if (!el || !view?.ResizeObserver) return;
    const observer = new view.ResizeObserver(() =>
      setTravel(Math.max(el.clientWidth - TRACK_PAD * 2 - FILL_PX, 0)),
    );
    observer.observe(el);
    const frame = view.requestAnimationFrame(() => setReady(true));
    return () => {
      view.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  const last = EFFORTS.length - 1;
  const offset = (travel * level) / last;

  const pick = (clientX: number) => {
    const el = trackRef.current;
    if (!el || travel <= 0) return;
    const box = el.getBoundingClientRect();
    const fraction = (clientX - box.left - TRACK_PAD - FILL_PX / 2) / travel;
    const next = Math.round(Math.min(Math.max(fraction, 0), 1) * last);
    if (next !== level) onChange(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step: Record<string, number> = {
      ArrowRight: 1,
      ArrowUp: 1,
      ArrowLeft: -1,
      ArrowDown: -1,
    };
    if (event.key in step) {
      event.preventDefault();
      onChange(Math.min(Math.max(level + step[event.key], 0), last));
    } else if (event.key === "Home") {
      event.preventDefault();
      onChange(0);
    } else if (event.key === "End") {
      event.preventDefault();
      onChange(last);
    }
  };

  const glide = cx(
    ready &&
      "transition-transform duration-[220ms] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
    dragging && "duration-[120ms]",
  );

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={0}
      aria-label="Reasoning effort"
      aria-valuemin={0}
      aria-valuemax={last}
      aria-valuenow={level}
      aria-valuetext={EFFORTS[level]}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
        pick(event.clientX);
      }}
      onPointerMove={(event) => dragging && pick(event.clientX)}
      onPointerUp={() => setDragging(false)}
      onPointerCancel={() => setDragging(false)}
      className="relative h-12 w-full max-w-sm cursor-pointer touch-none rounded-full border border-neutral-200 bg-neutral-100 focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rb-accent,oklch(20.5%_0_0))] dark:border-neutral-800 dark:bg-neutral-900 dark:focus-visible:outline-[var(--rb-accent,oklch(100%_0_0))]"
    >
      <div className="absolute left-2 right-2 top-1/2 h-8 -translate-y-1/2 overflow-hidden rounded-full">
        <div
          className={cx(
            "absolute inset-0 rounded-full bg-neutral-900 dark:bg-white",
            glide,
          )}
          style={{ transform: `translateX(${offset - travel}px)` }}
        />
      </div>

      {EFFORTS.map((name, index) => {
        if (index === level) return null;
        const filled = index < level;
        return (
          <span
            key={name}
            aria-hidden
            className={cx(
              "pointer-events-none absolute top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full",
              filled
                ? "bg-white/45 dark:bg-neutral-900/45"
                : "bg-neutral-400 dark:bg-neutral-600",
            )}
            style={{
              left: `${TRACK_PAD + FILL_PX / 2 - 3 + (travel * index) / last}px`,
            }}
          />
        );
      })}

      <div
        aria-hidden
        className={cx(
          "absolute top-1/2 h-6 w-6 rounded-full bg-[var(--rb-accent,oklch(100%_0_0))] dark:bg-[var(--rb-accent,oklch(20.5%_0_0))]",
          glide,
        )}
        style={{
          left: `${TRACK_PAD + THUMB_INSET}px`,
          transform: `translate(${offset}px, -50%)`,
        }}
      />
    </div>
  );
}

type Option = {
  name: string;
  hint: string;
  icon?: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
};

const MODELS: Option[] = [
  { name: "Atlas", hint: "Balanced speed and depth" },
  { name: "Atlas Pro", hint: "Deepest reasoning" },
  { name: "Quill", hint: "Fastest, for short tasks" },
];

function Dropdown({
  label,
  options,
  value,
  onChange,
  triggerMaxWidth,
}: {
  label: string;
  options: Option[];
  value: string;
  onChange: (next: string) => void;
  triggerMaxWidth?: string;
}) {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!open) return;
    const doc = rootRef.current?.ownerDocument ?? document;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setShown(false);
      }
    };
    doc.addEventListener("pointerdown", onPointerDown);
    return () => doc.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (open) menuRef.current?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => () => cancelAnimationFrame(frameRef.current ?? 0), []);

  const openMenu = (index: number, withAnimation: boolean) => {
    setActive(index);
    setOpen(true);
    if (withAnimation) {
      setShown(false);
      frameRef.current = requestAnimationFrame(() => setShown(true));
    } else {
      setShown(true);
    }
  };

  const close = (restoreFocus = true) => {
    setOpen(false);
    setShown(false);
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
  };

  const select = (index: number) => {
    onChange(options[index].name);
    close();
  };

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      openMenu(0, false);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      openMenu(options.length - 1, false);
    }
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        close();
        break;
      case "ArrowDown":
        event.preventDefault();
        setActive((i) => (i + 1) % options.length);
        break;
      case "ArrowUp":
        event.preventDefault();
        setActive((i) => (i - 1 + options.length) % options.length);
        break;
      case "Home":
        event.preventDefault();
        setActive(0);
        break;
      case "End":
        event.preventDefault();
        setActive(options.length - 1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        select(active);
        break;
      case "Tab":
        close(false);
        break;
    }
  };

  return (
    <div ref={rootRef} className="relative">
      {open && (
        <div
          ref={menuRef}
          role="listbox"
          aria-label={label}
          tabIndex={-1}
          onKeyDown={onMenuKeyDown}
          className={cx(
            "absolute bottom-full left-0 z-30 mb-2 w-64 origin-bottom-left overflow-hidden rounded-[var(--rb-r-2xl,14px)] border border-neutral-200 bg-white p-1 shadow-[0_4px_16px_-4px_rgba(0,0,0,0.10)] outline-none transition-[opacity,transform] duration-[180ms] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-none",
            shown ? "scale-100 opacity-100" : "scale-95 opacity-0",
          )}
        >
          {options.map((item, index) => {
            const selected = item.name === value;
            return (
              <button
                key={item.name}
                type="button"
                role="option"
                aria-selected={selected}
                tabIndex={-1}
                onClick={() => select(index)}
                onPointerMove={() => setActive(index)}
                className={cx(
                  "flex w-full cursor-pointer items-center gap-2.5 rounded-[var(--rb-r-md,8px)] px-2 py-1.5 text-left transition-[transform,background-color,color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.99]",
                  index === active
                    ? "bg-neutral-100 dark:bg-neutral-800"
                    : "bg-transparent",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-neutral-900 dark:text-neutral-100">
                    {item.name}
                  </span>
                  <span className="block truncate text-xs text-neutral-500">
                    {item.hint}
                  </span>
                </span>
                {selected && (
                  <Check
                    className="h-3.5 w-3.5 shrink-0 text-neutral-900 dark:text-neutral-100"
                    aria-hidden
                  />
                )}
              </button>
            );
          })}
        </div>
      )}

      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${value}`}
        onClick={() => (open ? close() : openMenu(0, true))}
        onKeyDown={onTriggerKeyDown}
        className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-[var(--rb-r-md,8px)] bg-neutral-100 px-2 text-[13px] font-medium text-neutral-700 transition-[transform,background-color,color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-neutral-200 hover:text-neutral-900 active:scale-[0.97] focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rb-accent,oklch(20.5%_0_0))] dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700 dark:hover:text-neutral-100 dark:focus-visible:outline-[var(--rb-accent,oklch(100%_0_0))]"
      >
        <span className={cx("truncate", triggerMaxWidth)}>{value}</span>
        <ChevronDown
          className="h-3.5 w-3.5 shrink-0 text-neutral-500"
          aria-hidden
        />
      </button>
    </div>
  );
}

const COMMANDS = [
  {
    command: "/summarize",
    label: "Summarize the thread",
    icon: FileText,
  },
  {
    command: "/explain",
    label: "Explain this code",
    icon: Code,
  },
  {
    command: "/tests",
    label: "Write unit tests",
    icon: FlaskConical,
  },
  {
    command: "/docs",
    label: "Search the docs",
    icon: BookOpen,
  },
  {
    command: "/fix",
    label: "Fix the failing build",
    icon: Wrench,
  },
];

const INITIAL_ATTACHMENTS = [
  { name: "auth-service.ts", size: "12 KB" },
  { name: "billing-invoice-4021.pdf", size: "1.2 MB" },
];

const MAX_COMPOSER_HEIGHT = 200;

export default function PromptInput1() {
  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState(INITIAL_ATTACHMENTS);
  const [model, setModel] = useState(MODELS[0].name);
  const [dismissed, setDismissed] = useState(false);
  const [commandIndex, setCommandIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [effort, setEffort] = useState(1);
  const [settledEffort, setSettledEffort] = useState(1);
  const [effortOpen, setEffortOpen] = useState(false);
  const [effortShown, setEffortShown] = useState(false);
  const [recording, setRecording] = useState(false);
  const [menuMax, setMenuMax] = useState<number>();
  const rootRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const effortPanelRef = useRef<HTMLDivElement>(null);
  const effortTriggerRef = useRef<HTMLButtonElement>(null);
  const effortFrame = useRef<number | undefined>(undefined);
  const effortExit = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const effortRestore = useRef(false);
  const listId = useId();
  const sendTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;

    const resize = () => {
      el.style.height = "auto";
      if (el.scrollHeight === 0) return;
      el.style.height = `${Math.min(el.scrollHeight, MAX_COMPOSER_HEIGHT)}px`;
    };

    resize();
    const frame = requestAnimationFrame(resize);
    el.ownerDocument.fonts?.ready.then(resize).catch(() => {});

    let lastWidth = el.clientWidth;
    const view = el.ownerDocument.defaultView;
    if (!view?.ResizeObserver) return () => cancelAnimationFrame(frame);
    const observer = new view.ResizeObserver(() => {
      if (el.clientWidth === lastWidth) return;
      lastWidth = el.clientWidth;
      resize();
    });
    observer.observe(el);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [value]);

  useEffect(() => () => clearTimeout(sendTimer.current), []);

  useEffect(
    () => () => {
      cancelAnimationFrame(effortFrame.current ?? 0);
      clearTimeout(effortExit.current);
    },
    [],
  );

  const openEffort = (animate: boolean) => {
    clearTimeout(effortExit.current);
    setEffortOpen(true);
    if (animate) {
      setEffortShown(false);
      effortFrame.current = requestAnimationFrame(() => setEffortShown(true));
    } else {
      setEffortShown(true);
    }
  };

  const closeEffort = (restoreFocus = true) => {
    cancelAnimationFrame(effortFrame.current ?? 0);
    clearTimeout(effortExit.current);
    effortRestore.current = restoreFocus;
    setEffortShown(false);
    effortExit.current = setTimeout(() => setEffortOpen(false), EFFORT_EXIT_MS);
  };

  useEffect(() => {
    if (effortOpen || !effortRestore.current) return;
    effortRestore.current = false;
    effortTriggerRef.current?.focus({ preventScroll: true });
  }, [effortOpen]);

  useEffect(() => {
    if (effortOpen) return;
    const timer = setTimeout(() => setSettledEffort(effort), EFFORT_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [effortOpen, effort]);

  useEffect(() => {
    if (!effortOpen) return;
    const panel = effortPanelRef.current;
    const doc = panel?.ownerDocument ?? document;
    const onPointerDown = (event: PointerEvent) => {
      const slider = panel?.querySelector('[role="slider"]');
      if (slider?.contains(event.target as Node)) return;
      effortRestore.current = false;
      setEffortShown(false);
      effortExit.current = setTimeout(
        () => setEffortOpen(false),
        EFFORT_EXIT_MS,
      );
    };
    doc.addEventListener("pointerdown", onPointerDown);
    return () => doc.removeEventListener("pointerdown", onPointerDown);
  }, [effortOpen]);

  useEffect(() => {
    if (effortShown) {
      effortPanelRef.current
        ?.querySelector<HTMLElement>('[role="slider"]')
        ?.focus({ preventScroll: true });
    }
  }, [effortShown]);

  const query = value.startsWith("/") ? value.slice(1).toLowerCase() : null;
  const matches = useMemo(() => {
    if (query === null) return [];
    return COMMANDS.filter((c) => c.command.slice(1).startsWith(query));
  }, [query]);
  const menuOpen = matches.length > 0 && !busy && !dismissed;
  const activeCommand = Math.min(commandIndex, Math.max(0, matches.length - 1));

  const canSend = (value.trim().length > 0 || attachments.length > 0) && !busy;

  const runCommand = (command: string) => {
    setValue(`${command} `);
    textareaRef.current?.focus({ preventScroll: true });
  };

  const addAttachment = () => {
    setAttachments((prev) => [
      ...prev,
      {
        name: `reference-${prev.length + 1}.md`,
        size: `${8 + prev.length * 3} KB`,
      },
    ]);
  };

  const submit = () => {
    if (!canSend) return;
    setBusy(true);
    setValue("");
    setAttachments([]);
    sendTimer.current = setTimeout(() => setBusy(false), 1800);
  };

  const cancel = () => {
    clearTimeout(sendTimer.current);
    setBusy(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (menuOpen) {
      switch (event.key) {
        case "Escape":
          event.preventDefault();
          setDismissed(true);
          return;
        case "ArrowDown":
          event.preventDefault();
          setCommandIndex((i) => (i + 1) % matches.length);
          return;
        case "ArrowUp":
          event.preventDefault();
          setCommandIndex((i) => (i - 1 + matches.length) % matches.length);
          return;
        case "Home":
          event.preventDefault();
          setCommandIndex(0);
          return;
        case "End":
          event.preventDefault();
          setCommandIndex(matches.length - 1);
          return;
        case "Enter":
        case "Tab":
          event.preventDefault();
          runCommand(matches[activeCommand].command);
          return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  useLayoutEffect(() => {
    if (!menuOpen) return;
    const root = rootRef.current;
    const anchor = anchorRef.current;
    if (!root || !anchor) return;
    const space =
      anchor.getBoundingClientRect().top - root.getBoundingClientRect().top;
    setMenuMax(Math.max(space - MENU_GUTTER, MENU_MIN_H));
  }, [menuOpen, matches.length]);

  useEffect(() => {
    if (!menuOpen) return;
    const menu = menuRef.current;
    const option = menu?.children[activeCommand];
    if (!(option instanceof HTMLElement) || !menu) return;
    const top = option.offsetTop;
    const bottom = top + option.offsetHeight;
    if (top < menu.scrollTop) menu.scrollTop = top;
    else if (bottom > menu.scrollTop + menu.clientHeight)
      menu.scrollTop = bottom - menu.clientHeight;
  }, [activeCommand, menuOpen]);

  const onChange = (next: string) => {
    setDismissed(false);
    setCommandIndex(0);
    setValue(next);
  };

  return (
    <div
      ref={rootRef}
      className="relative flex h-full w-full min-h-[560px] flex-col overflow-hidden bg-white dark:bg-neutral-950"
    >
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-4 py-8 sm:px-6">
        <div ref={anchorRef} className="relative w-full">
          {menuOpen && (
            <div
              id={`${listId}-menu`}
              ref={menuRef}
              role="listbox"
              aria-label="Commands"
              style={{ maxHeight: menuMax }}
              className="absolute bottom-full left-0 z-30 mb-2 w-72 origin-bottom-left overflow-y-auto overscroll-contain rounded-[var(--rb-r-2xl,14px)] border border-neutral-200 bg-white p-1 shadow-[0_4px_16px_-4px_rgba(0,0,0,0.10)] dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-none"
            >
              {matches.map((item, index) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.command}
                    id={`${listId}-option-${index}`}
                    type="button"
                    role="option"
                    aria-selected={index === activeCommand}
                    tabIndex={-1}
                    onClick={() => runCommand(item.command)}
                    onPointerMove={() => setCommandIndex(index)}
                    className={cx(
                      "flex w-full cursor-pointer items-center gap-2.5 rounded-[var(--rb-r-md,8px)] px-2 py-1.5 text-left transition-[transform,background-color,color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.99]",
                      index === activeCommand
                        ? "bg-neutral-100 dark:bg-neutral-800"
                        : "bg-transparent",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0 text-neutral-500" />
                    <span className="min-w-0 flex-1 truncate text-[13px] text-neutral-900 dark:text-neutral-100">
                      {item.label}
                    </span>
                    <span className="shrink-0 font-mono text-xs text-neutral-500">
                      {item.command}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="relative">
            <div
              inert={effortOpen}
              className={cx(
                "rounded-[var(--rb-r-2xl,14px)] border border-neutral-200 bg-white transition-[filter,transform,opacity] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] focus-within:border-neutral-300 motion-reduce:transition-[filter,opacity] dark:border-neutral-800 dark:bg-neutral-900 dark:focus-within:border-neutral-700",
                effortShown && "scale-[0.99] opacity-60 blur-[6px]",
              )}
            >
              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-1.5 px-2.5 pt-2.5">
                  {attachments.map((file) => (
                    <span
                      key={file.name}
                      className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-[var(--rb-r-sm,6px)] bg-neutral-100 pl-2 pr-1 text-[13px] text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
                    >
                      <Paperclip className="h-3.5 w-3.5 shrink-0 text-neutral-500" />
                      <span className="min-w-0 truncate">{file.name}</span>
                      <span className="shrink-0 tabular-nums text-neutral-500">
                        {file.size}
                      </span>
                      <button
                        type="button"
                        aria-label={`Remove ${file.name}`}
                        onClick={() =>
                          setAttachments((prev) =>
                            prev.filter((f) => f.name !== file.name),
                          )
                        }
                        className="inline-flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-[var(--rb-r-xs,4px)] bg-white text-neutral-500 transition-[transform,background-color,color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-neutral-200 hover:text-neutral-700 active:scale-[0.97] focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--rb-accent,oklch(20.5%_0_0))] dark:bg-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-200 dark:focus-visible:outline-[var(--rb-accent,oklch(100%_0_0))]"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <textarea
                ref={textareaRef}
                rows={1}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Ask anything"
                aria-label="Message"
                role="combobox"
                aria-expanded={menuOpen}
                aria-controls={menuOpen ? `${listId}-menu` : undefined}
                aria-activedescendant={
                  menuOpen ? `${listId}-option-${activeCommand}` : undefined
                }
                aria-autocomplete="list"
                className="block max-h-[200px] min-h-[52px] w-full resize-none bg-transparent px-4 py-3.5 text-sm leading-relaxed text-neutral-900 outline-none placeholder:text-neutral-500 dark:text-neutral-100 dark:placeholder:text-neutral-500"
              />

              <div className="flex items-center gap-1 px-2.5 pb-2.5 pt-1">
                <button
                  type="button"
                  aria-label="Attach a file"
                  onClick={addAttachment}
                  className="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-[var(--rb-r-md,8px)] bg-neutral-100 text-neutral-500 transition-[transform,background-color,color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-neutral-200 hover:text-neutral-700 active:scale-[0.97] focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rb-accent,oklch(20.5%_0_0))] dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-200 dark:focus-visible:outline-[var(--rb-accent,oklch(100%_0_0))]"
                >
                  <Paperclip className="h-4 w-4 shrink-0" />
                </button>

                <Dropdown
                  label="Model"
                  options={MODELS}
                  value={model}
                  onChange={setModel}
                  triggerMaxWidth="max-w-[10rem]"
                />

                {busy ? (
                  <button
                    type="button"
                    onClick={cancel}
                    aria-label="Stop generating"
                    className="ml-auto inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-[var(--rb-r-md,8px)] bg-[var(--rb-accent,oklch(20.5%_0_0))] text-[var(--rb-accent-fg,oklch(100%_0_0))] transition-[transform,background-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-[color-mix(in_oklab,var(--rb-accent,oklch(20.5%_0_0))_90%,transparent)] active:scale-95 focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rb-accent,oklch(20.5%_0_0))] dark:bg-[var(--rb-accent,oklch(100%_0_0))] dark:text-[var(--rb-accent-fg,oklch(20.5%_0_0))] dark:hover:bg-[color-mix(in_oklab,var(--rb-accent,oklch(100%_0_0))_90%,transparent)] dark:focus-visible:outline-[var(--rb-accent,oklch(100%_0_0))]"
                  >
                    <Square className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  </button>
                ) : (
                  <div className="ml-auto flex items-center gap-1">
                    <button
                      ref={effortTriggerRef}
                      type="button"
                      aria-haspopup="dialog"
                      aria-expanded={effortOpen}
                      aria-label={`Reasoning effort: ${EFFORTS[effort]}`}
                      onClick={(event) =>
                        effortOpen
                          ? closeEffort()
                          : openEffort(event.detail > 0)
                      }
                      className="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-[var(--rb-r-md,8px)] bg-neutral-100 text-neutral-500 transition-[transform,background-color,color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-neutral-200 hover:text-neutral-700 active:scale-[0.97] focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rb-accent,oklch(20.5%_0_0))] dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-200 dark:focus-visible:outline-[var(--rb-accent,oklch(100%_0_0))]"
                    >
                      <EffortGauge level={settledEffort} />
                    </button>

                    <button
                      type="button"
                      aria-pressed={recording}
                      aria-label={recording ? "Stop recording" : "Record voice"}
                      onClick={() => setRecording((on) => !on)}
                      className={cx(
                        "inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-[var(--rb-r-md,8px)] transition-[transform,background-color,color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rb-accent,oklch(20.5%_0_0))] dark:focus-visible:outline-[var(--rb-accent,oklch(100%_0_0))]",
                        recording
                          ? "bg-[var(--rb-accent,oklch(20.5%_0_0))] text-[var(--rb-accent-fg,oklch(100%_0_0))] hover:bg-[color-mix(in_oklab,var(--rb-accent,oklch(20.5%_0_0))_90%,transparent)] dark:bg-[var(--rb-accent,oklch(100%_0_0))] dark:text-[var(--rb-accent-fg,oklch(20.5%_0_0))] dark:hover:bg-[color-mix(in_oklab,var(--rb-accent,oklch(100%_0_0))_90%,transparent)]"
                          : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200 hover:text-neutral-700 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-200",
                      )}
                    >
                      <Mic className="h-4 w-4 shrink-0" />
                    </button>

                    <button
                      type="button"
                      aria-label="Send"
                      disabled={!canSend}
                      onClick={submit}
                      className="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-[var(--rb-r-md,8px)] bg-[var(--rb-accent,oklch(20.5%_0_0))] text-[var(--rb-accent-fg,oklch(100%_0_0))] transition-[transform,background-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-[color-mix(in_oklab,var(--rb-accent,oklch(20.5%_0_0))_90%,transparent)] active:scale-95 focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rb-accent,oklch(20.5%_0_0))] disabled:pointer-events-none disabled:bg-neutral-200 disabled:text-neutral-400 dark:bg-[var(--rb-accent,oklch(100%_0_0))] dark:text-[var(--rb-accent-fg,oklch(20.5%_0_0))] dark:hover:bg-[color-mix(in_oklab,var(--rb-accent,oklch(100%_0_0))_90%,transparent)] dark:focus-visible:outline-[var(--rb-accent,oklch(100%_0_0))] dark:disabled:bg-neutral-700 dark:disabled:text-neutral-500"
                    >
                      <ArrowUp className="h-4 w-4 shrink-0" />
                    </button>
                  </div>
                )}
              </div>
            </div>

            {effortOpen && (
              <div
                ref={effortPanelRef}
                role="dialog"
                aria-label="Reasoning effort"
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    closeEffort();
                  }
                }}
                className={cx(
                  "absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 transition-opacity ease-[cubic-bezier(0.23,1,0.32,1)]",
                  effortShown
                    ? "opacity-100 duration-[180ms]"
                    : "opacity-0 duration-[120ms]",
                )}
              >
                <div
                  aria-hidden
                  className="absolute inset-0 rounded-[var(--rb-r-2xl,14px)] bg-white/70 dark:bg-neutral-950/70"
                />
                <p className="relative text-sm font-medium text-neutral-900 dark:text-neutral-100">
                  {EFFORTS[effort]}
                </p>
                <EffortSlider level={effort} onChange={setEffort} />
              </div>
            )}
          </div>

          <p className="mt-3 px-1 text-xs text-neutral-500">
            {busy
              ? "Working on it…"
              : "Type / to run a command, or drop a file to attach it."}
          </p>
        </div>
      </div>
    </div>
  );
}
