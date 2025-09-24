import { c } from './colors.js';
import { canPrompt, promptSelect } from './interactive.js';

export type WizardStepDecision = 'retry' | 'back' | 'cancel';

export interface WizardErrorOptions {
  /** Additional context to display before presenting retry choices. */
  message?: string;
  /** Whether the caller supports navigating back to a previous step. */
  allowBack?: boolean;
  /** Whether the caller supports canceling the entire flow. Defaults to true. */
  allowCancel?: boolean;
  /** Custom prompt label for the retry selector. */
  prompt?: string;
  /** Default decision when prompting is not possible. Defaults to 'retry'. */
  nonInteractiveDecision?: WizardStepDecision;
}

export interface WizardAttemptResult<T> {
  status: 'ok' | 'back' | 'cancel';
  value?: T;
}

/**
 * Executes an async step that may throw and offers retry/back/cancel affordances when it does.
 *
 * The supplied callback should throw an Error (or string) when validation fails. This helper
 * catches the error, prints a formatted message, and prompts the user for the next action.
 */
export async function wizardAttempt<T>(
  perform: () => Promise<T>,
  options: WizardErrorOptions = {},
): Promise<WizardAttemptResult<T>> {
  const allowCancel = options.allowCancel !== false;
  const allowBack = options.allowBack === true;
  const promptMessage = options.prompt ?? 'How would you like to proceed?';

  while (true) {
    try {
      const value = await perform();
      return { status: 'ok', value };
    } catch (error) {
      const formatted = formatError(error);
      if (formatted) {
        console.log(c.error(formatted));
      }
      if (options.message) {
        console.log(options.message);
      }

      if (!canPrompt()) {
        const fallback = options.nonInteractiveDecision ?? 'retry';
        if (fallback === 'retry') {
          continue;
        }
        return { status: fallback };
      }

      const choices: Array<{ label: string; value: WizardStepDecision }> = [
        { label: 'Try again', value: 'retry' },
      ];
      if (allowBack) {
        choices.push({ label: 'Go back', value: 'back' });
      }
      if (allowCancel) {
        choices.push({ label: 'Cancel', value: 'cancel' });
      }

      const selection = await promptSelect(promptMessage, choices, {
        allowCustom: false,
        defaultValue: allowBack ? 'back' : 'retry',
      });

      const decision = (selection as WizardStepDecision | undefined) ?? 'retry';
      if (decision === 'retry') {
        continue;
      }
      return { status: decision };
    }
  }
}

function formatError(error: unknown): string {
  if (!error) return 'Unknown error';
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
