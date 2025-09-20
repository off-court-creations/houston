import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormatsImport from 'ajv-formats';
import type { ErrorObject, ValidateFunction } from 'ajv';
import { globSync } from 'glob';

export interface SchemaValidationResult {
  valid: boolean;
  errors: ErrorObject[] | null | undefined;
}

type AjvInstance = {
  addSchema: (schema: unknown, key?: string) => void;
  getSchema: (key: string) => ValidateFunction<unknown> | undefined;
  compile: (schema: unknown) => ValidateFunction<unknown>;
};

const AjvCtor = Ajv2020 as unknown as new (options?: Record<string, unknown>) => AjvInstance;
const addFormats = addFormatsImport as unknown as (ajv: AjvInstance) => void;

export class SchemaRegistry {
  private readonly ajv: AjvInstance;
  private readonly validators = new Map<string, ValidateFunction<unknown>>();

  constructor(private readonly schemaDir: string) {
    this.ajv = new AjvCtor({
      allErrors: true,
      strict: false,
      allowUnionTypes: true,
    });
    addFormats(this.ajv);
    this.loadSchemas();
  }

  validate(schemaKey: string, data: unknown): SchemaValidationResult {
    const validator = this.validators.get(schemaKey);
    if (!validator) {
      throw new Error(`Unknown schema key: ${schemaKey}`);
    }
    const valid = validator(data);
    return { valid, errors: validator.errors };
  }

  listSchemas(): string[] {
    return Array.from(this.validators.keys()).sort();
  }

  private loadSchemas(): void {
    const pattern = '**/*.schema.json';
    const loadedPaths = new Set<string>();

    const loadFromDir = (dir: string): void => {
      const files = globSync(pattern, { cwd: dir, nodir: true }).sort();
      for (const relative of files) {
        const fullPath = path.join(dir, relative);
        if (loadedPaths.has(fullPath)) continue;
        loadedPaths.add(fullPath);
        const raw = fs.readFileSync(fullPath, 'utf8');
        let schema: unknown;
        try {
          schema = JSON.parse(raw);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`Failed to parse schema ${relative}: ${message}`);
        }
        const key = relative.replace(/\.schema\.json$/, '').replace(/\\/g, '/');
        this.ajv.addSchema(schema);
        this.ajv.addSchema(schema, key);
        let validator = this.ajv.getSchema(key);
        if (!validator) {
          const schemaId = (schema as { $id?: string }).$id;
          if (schemaId) {
            validator = this.ajv.getSchema(schemaId);
          }
        }
        if (!validator) {
          validator = this.ajv.compile(schema as object);
        }
        this.validators.set(key, validator);
      }
    };

    // Load from workspace first
    loadFromDir(this.schemaDir);

    // Also load built-in bundled schemas to ensure required keys exist
    const here = path.dirname(fileURLToPath(new URL('.', import.meta.url)));
    const candidate = path.resolve(here, '../../schema');
    if (fs.existsSync(candidate)) {
      loadFromDir(candidate);
    }
  }
}
