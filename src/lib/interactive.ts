import process from 'node:process';
import { promptInput as rlInput, promptMultiSelect as rlMulti, promptSelect as rlSelect } from './prompter.js';
import { setEnabled as setColorEnabled, isEnabled as colorsEnabled } from './colors.js';

type TextOptions = {
  defaultValue?: string;
  required?: boolean;
  allowEmpty?: boolean;
  placeholder?: string;
  validate?: (value: string) => string | null;
};

type ConfirmOptions = {
  defaultValue?: boolean;
};

type Choice = { label: string; value: string };

type SelectOptions = {
  defaultValue?: string;
  allowCustom?: boolean;
  allowNone?: boolean;
};

type MultiSelectOptions = {
  defaultValue?: string[];
  required?: boolean;
  allowEmpty?: boolean;
};

// Routing thresholds
const SELECT_THRESHOLD = 40;
const MULTI_THRESHOLD = 30;

export function canPrompt(): boolean {
  return (
    process.env.HOUSTON_NO_INTERACTIVE !== '1' &&
    ((((process.stdin as any).isTTY && (process.stdout as any).isTTY) ||
      process.env.HOUSTON_FORCE_INTERACTIVE === '1'))
  );
}

async function getClack(): Promise<any | null> {
  try {
    const stdinTty = (process.stdin as any).isTTY;
    const stdoutTty = (process.stdout as any).isTTY;
    if (!stdinTty || !stdoutTty) {
      // Only use clack when attached to a real TTY to avoid uv_tty_init errors in tests/CI.
      return null;
    }
    const mod = await import('@clack/prompts');
    return mod;
  } catch {
    return null;
  }
}

async function getEnquirer(): Promise<{
  AutoComplete?: any;
  MultiSelect?: any;
} | null> {
  try {
    const mod: any = await import('enquirer');
    return mod;
  } catch {
    return null;
  }
}

export async function intro(message: string): Promise<void> {
  const p = await getClack();
  if (p) {
    p.intro(message);
  } else {
    console.log(message);
  }
}

export async function outro(message: string): Promise<void> {
  const p = await getClack();
  if (p) {
    p.outro(message);
  } else {
    console.log(message);
  }
}

export function spinner() {
  let sp: any | null = null;
  return {
    async start(text: string) {
      const p = await getClack();
      if (p) {
        sp = p.spinner();
        sp.start(text);
      } else {
        console.log(text);
      }
    },
    stop(text?: string) {
      if (sp) {
        sp.stop(text);
      } else if (text) {
        console.log(text);
      }
    },
    stopWithError(text?: string) {
      if (sp) {
        try {
          sp.stop(text ?? 'Failed');
        } catch {
          // ignore
        }
      } else if (text) {
        console.log(text);
      }
    },
  };
}

export async function promptText(question: string, opts: TextOptions = {}): Promise<string> {
  const p = await getClack();
  if (!p || !canPrompt()) {
    return rlInput(question, {
      defaultValue: opts.defaultValue,
      required: opts.required,
      allowEmpty: !opts.required,
      validate: opts.validate,
    });
  }
  const res = await p.text({
    message: question,
    initialValue: opts.defaultValue,
    placeholder: opts.placeholder,
    validate: (value: string) => {
      if (opts.required && !opts.allowEmpty && value.trim() === '') return 'A value is required.';
      const msg = opts.validate?.(value);
      return msg ?? undefined;
    },
  });
  if (p.isCancel?.(res)) {
    p.cancel?.('Aborted');
    process.exit(130);
  }
  return String(res ?? '');
}

export async function promptSecret(question: string, opts: { required?: boolean } = {}): Promise<string> {
  const p = await getClack();
  if (!p || !canPrompt()) {
    // fallback to normal input without echo suppression
    return rlInput(question, { required: opts.required, allowEmpty: !opts.required });
  }
  const res = await (p as any).password?.({ message: question }) ?? await p.text({ message: question });
  if ((p as any).isCancel?.(res)) {
    (p as any).cancel?.('Aborted');
    process.exit(130);
  }
  return String(res ?? '');
}

export async function promptConfirm(question: string, defaultValue = false): Promise<boolean> {
  const p = await getClack();
  // When not attached to a real TTY, avoid interactive confirm and honor default.
  const stdinTty = (process.stdin as any).isTTY;
  const stdoutTty = (process.stdout as any).isTTY;
  if (!stdinTty || !stdoutTty || !p || !canPrompt()) {
    // Default to the provided value without prompting (prevents hanging in tests/CI).
    return Boolean(defaultValue);
  }
  const res = await p.confirm({ message: question, initialValue: defaultValue });
  if (p.isCancel?.(res)) {
    p.cancel?.('Aborted');
    process.exit(130);
  }
  return Boolean(res);
}

export async function promptSelect(
  question: string,
  choices: Choice[],
  opts: SelectOptions = {},
): Promise<string | undefined> {
  const many = choices.length > SELECT_THRESHOLD;
  if (!canPrompt()) {
    return rlSelect(question, choices, opts);
  }
  if (many) {
    const enq = await getEnquirer();
    if (enq?.AutoComplete) {
      const { AutoComplete } = enq;
      const list = [...choices];
      if (opts.allowNone) list.unshift({ label: 'None', value: '__none__' });
      if (opts.allowCustom) list.push({ label: 'Other…', value: '__custom__' });
      const prompt = new AutoComplete({
        name: 'value',
        message: question,
        limit: 10,
        choices: list.map((c) => ({ name: c.label, value: c.value })),
        result(value: string) {
          // value from enquirer is the selected value directly when using choices with value
          return value;
        },
      });
      const result: string = await prompt.run();
      if (result === '__none__') return undefined;
      if (result === '__custom__') {
        const custom = await promptText('Enter value', { required: true });
        return custom.trim();
      }
      return result;
    }
  }
  const p = await getClack();
  if (p) {
    const options = choices.map((c) => ({ label: c.label, value: c.value }));
    if (opts.allowNone) options.unshift({ label: 'None', value: '__none__' });
    if (opts.allowCustom) options.push({ label: 'Other…', value: '__custom__' });
    const res = await p.select({
      message: question,
      options,
      initialValue: opts.defaultValue,
    });
    if (p.isCancel?.(res)) {
      p.cancel?.('Aborted');
      process.exit(130);
    }
    if (res === '__none__') return undefined;
    if (res === '__custom__') {
      const custom = await promptText('Enter value', { required: true });
      return custom.trim();
    }
    return (res as string | undefined) ?? opts.defaultValue;
  }
  return rlSelect(question, choices, opts);
}

export async function promptMultiSelect(
  question: string,
  choices: string[],
  opts: MultiSelectOptions = {},
): Promise<string[]> {
  const many = choices.length > MULTI_THRESHOLD;
  // Guard: clack multiselect cannot handle zero options; fall back to readline
  if (choices.length === 0) {
    return rlMulti(question, choices, { defaultValue: opts.defaultValue, required: opts.required, allowEmpty: opts.allowEmpty });
  }
  if (!canPrompt()) {
    return rlMulti(question, choices, { defaultValue: opts.defaultValue, required: opts.required, allowEmpty: opts.allowEmpty });
  }
  if (many) {
    const enq = await getEnquirer();
    if (enq?.MultiSelect) {
      const { MultiSelect } = enq;
      const prompt = new MultiSelect({
        name: 'values',
        message: question,
        choices: choices.map((c) => ({ name: c, value: c })),
        initial: (opts.defaultValue ?? []).map((v) => choices.indexOf(v)).filter((i) => i >= 0),
        result(names: string[]) {
          return names; // values are already names we set to choice.value
        },
      });
      const result: string[] = await prompt.run();
      if ((result?.length ?? 0) === 0 && opts.required && !opts.allowEmpty) {
        // enforce selection by looping via fallback
        return rlMulti(question, choices, { defaultValue: opts.defaultValue, required: opts.required, allowEmpty: opts.allowEmpty });
      }
      return result;
    }
  }
  const p = await getClack();
  if (p) {
    const res = await p.multiselect({
      message: question,
      options: choices.map((c) => ({ label: c, value: c })),
      initialValues: opts.defaultValue,
      required: opts.required,
    });
    if (p.isCancel?.(res)) {
      p.cancel?.('Aborted');
      process.exit(130);
    }
    return (res as string[]) ?? [];
  }
  return rlMulti(question, choices, { defaultValue: opts.defaultValue, required: opts.required, allowEmpty: opts.allowEmpty });
}

// Expose color control passthrough (for testing/tweaks)
export function setColorsEnabled(value: boolean): void {
  setColorEnabled(value);
}
