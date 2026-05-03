/**
 * Multi-line progress UI for N items running in parallel.
 * Reserves one line per item; each line can show: waiting → running (with spinner) → done.
 * Use for eval execution and LLM judge so both share the same interactive behavior.
 */

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPINNER_INTERVAL_MS = 120;

function writeLineInPlace(text: string): void {
  process.stdout.write(`\r\x1b[K${text}`);
}

function cursorUp(n: number): void {
  if (n > 0) process.stdout.write(`\x1b[${n}A`);
}

function cursorDown(n: number): void {
  if (n > 0) process.stdout.write(`\x1b[${n}B`);
}

function updateLineAt(lineIndex: number, totalLines: number, text: string): void {
  const up = totalLines - lineIndex;
  cursorUp(up);
  writeLineInPlace(text);
  cursorDown(up);
}

export interface ProgressLinesOptions {
  /** When false, start/setRunning/setDone only log; no reserved lines or spinner. */
  interactive: boolean;
  /** One label per line (e.g. example names). */
  lineLabels: string[];
  /** Text after each label for items not yet started. */
  waitingLabel?: string;
  /** Default text after label + spinner when running. Overridden by setRunning(lineIndex, customLabel). */
  runningLabel?: string;
  /** Style for waiting/running text (e.g. dim). */
  dim?: (s: string) => string;
  /** Style for spinner character (e.g. cyan). */
  spinnerStyle?: (s: string) => string;
}

export interface ProgressLines {
  readonly totalLines: number;
  /** Print all lines in waiting state. Call once at start. */
  start(): void;
  /** Mark line as running. Spinner will animate. customLabel overrides runningLabel (e.g. "judging file 2/3 docKey"). */
  setRunning(lineIndex: number, customLabel?: string): void;
  /** Mark line as done with final text. Removes from running. extraLines are printed after (e.g. expected/got diff). */
  setDone(lineIndex: number, text: string, extraLines?: string[]): Promise<void>;
}

export function createProgressLines(options: ProgressLinesOptions): ProgressLines {
  const {
    interactive,
    lineLabels,
    waitingLabel = 'waiting',
    runningLabel = 'running',
    dim = (s: string) => s,
    spinnerStyle = (s: string) => s,
  } = options;

  const totalLines = lineLabels.length;
  const runningLabels = new Map<number, string>();
  let updateLock = Promise.resolve();
  let spinnerInterval: ReturnType<typeof setInterval> | null = null;
  let spinnerFrame = 0;

  const scheduleUpdate = (fn: () => void): Promise<void> => {
    const run = updateLock.then(() => fn());
    updateLock = run;
    return run;
  };

  const start = (): void => {
    if (!interactive || totalLines === 0) return;
    const wait = dim(waitingLabel);
    for (const label of lineLabels) {
      process.stdout.write(`${label}  ${wait}\n`);
    }
  };

  const setRunning = (lineIndex: number, customLabel?: string): void => {
    if (!interactive) return;
    runningLabels.set(lineIndex, customLabel ?? runningLabel);
    if (spinnerInterval === null) {
      spinnerInterval = setInterval(() => {
        updateLock = updateLock.then(() => {
          if (runningLabels.size === 0) {
            if (spinnerInterval) {
              clearInterval(spinnerInterval);
              spinnerInterval = null;
            }
            return;
          }
          const frame = SPINNER_FRAMES[spinnerFrame++ % SPINNER_FRAMES.length];
          for (const [i, label] of runningLabels) {
            const lineLabel = lineLabels[i] ?? '';
            updateLineAt(i, totalLines, `${lineLabel}  ${label} ${spinnerStyle(frame)}`);
          }
        });
      }, SPINNER_INTERVAL_MS);
    }
  };

  const setDone = async (
    lineIndex: number,
    text: string,
    extraLines: string[] = []
  ): Promise<void> => {
    if (interactive) {
      runningLabels.delete(lineIndex);
      await scheduleUpdate(() => updateLineAt(lineIndex, totalLines, text));
      for (const line of extraLines) console.log(line);
    } else {
      console.log(text);
      for (const line of extraLines) console.log(line);
    }
  };

  return {
    totalLines,
    start,
    setRunning,
    setDone,
  };
}
