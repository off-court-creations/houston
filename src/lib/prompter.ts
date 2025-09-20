import { createInterface } from 'node:readline/promises';
import process from 'node:process';

interface InputPromptOptions {
  defaultValue?: string;
  required?: boolean;
  allowEmpty?: boolean;
  validate?: (value: string) => string | null;
}

interface SelectChoice {
  label: string;
  value: string;
}

interface SelectPromptOptions {
  defaultValue?: string;
  allowCustom?: boolean;
  allowNone?: boolean;
}

interface MultiSelectOptions {
  defaultValue?: string[];
  required?: boolean;
  allowEmpty?: boolean;
}

export async function promptInput(question: string, options: InputPromptOptions = {}): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    while (true) {
      const suffix = options.defaultValue ? ` [${options.defaultValue}]` : '';
      const answer = await rl.question(`${question}${suffix}: `);
      const raw = answer.trim();
      const value = raw === '' && options.defaultValue !== undefined ? options.defaultValue : raw;

      if (!value && options.required && !options.allowEmpty) {
        console.log('A value is required.');
        continue;
      }

      if (options.validate) {
        const error = options.validate(value);
        if (error) {
          console.log(error);
          continue;
        }
      }

      return value;
    }
  } finally {
    rl.close();
  }
}

export async function promptSelect(
  question: string,
  choices: SelectChoice[],
  options: SelectPromptOptions = {},
): Promise<string | undefined> {
  const allowCustom = options.allowCustom ?? true;
  const allowNone = options.allowNone ?? false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    while (true) {
      console.log(question);
      choices.forEach((choice, index) => {
        console.log(`  ${index + 1}) ${choice.label}`);
      });
      if (allowNone) {
        console.log('  0) None');
      }
      const prompt = options.defaultValue ? `Select option [${options.defaultValue}]: ` : 'Select option: ';
      const answer = await rl.question(prompt);
      const trimmed = answer.trim();

      if (trimmed === '' && options.defaultValue !== undefined) {
        return options.defaultValue;
      }

      if ((trimmed === '' || trimmed === '0') && allowNone) {
        return undefined;
      }

      const numeric = Number.parseInt(trimmed, 10);
      if (!Number.isNaN(numeric) && numeric >= 1 && numeric <= choices.length) {
        return choices[numeric - 1]!.value;
      }

      const exactMatch = choices.find((choice) => choice.value === trimmed || choice.label === trimmed);
      if (exactMatch) {
        return exactMatch.value;
      }

      if (allowCustom && trimmed !== '') {
        return trimmed;
      }

      console.log('Invalid selection. Please try again.');
    }
  } finally {
    rl.close();
  }
}

export async function promptMultiSelect(
  question: string,
  choices: string[],
  options: MultiSelectOptions = {},
): Promise<string[]> {
  const defaultValues = options.defaultValue ?? [];
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    while (true) {
      console.log(question);
      if (choices.length > 0) {
        choices.forEach((choice, index) => {
          console.log(`  ${index + 1}) ${choice}`);
        });
      } else {
        console.log('  (no predefined options; enter custom values)');
      }
      if (defaultValues.length > 0) {
        console.log(`Current selection: ${defaultValues.join(', ')}`);
      }
      console.log('Enter comma separated numbers or values (leave blank to keep current selection).');
      const answer = await rl.question('> ');
      const trimmed = answer.trim();

      if (trimmed === '') {
        if (defaultValues.length > 0) {
          return defaultValues;
        }
        if (options.allowEmpty || !options.required) {
          return [];
        }
        console.log('Please select at least one value.');
        continue;
      }

      const tokens = trimmed
        .split(',')
        .map((token) => token.trim())
        .filter(Boolean);

      const selection = new Set<string>();
      for (const token of tokens) {
        const numeric = Number.parseInt(token, 10);
        if (!Number.isNaN(numeric) && numeric >= 1 && numeric <= choices.length) {
          selection.add(choices[numeric - 1]!);
          continue;
        }
        if (choices.includes(token)) {
          selection.add(token);
          continue;
        }
        selection.add(token);
      }

      if (selection.size === 0 && options.required && !options.allowEmpty) {
        console.log('Please select at least one value.');
        continue;
      }

      return Array.from(selection.values());
    }
  } finally {
    rl.close();
  }
}
