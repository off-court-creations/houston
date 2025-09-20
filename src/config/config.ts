import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { createLogger } from '../logger.js';

const CONFIG_FILE_CANDIDATES = ['stardate.config.yaml', 'stardate.config.yml'];

export interface TrackingConfig {
  root: string;
  schemaDir: string;
  ticketsDir: string;
  backlogDir: string;
  sprintsDir: string;
}

export interface CliMetadata {
  version: string;
  generator: string;
}

export interface CliConfig {
  workspaceRoot: string;
  tracking: TrackingConfig;
  metadata: CliMetadata;
}

const logger = createLogger();

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolveWorkspaceRoot(startDir: string): string {
  return fs.realpathSync(startDir);
}

function applyDefaults(workspaceRoot: string, configFromFile: Partial<CliConfig> | undefined, pkgVersion: string): CliConfig {
  const trackingRoot = configFromFile?.tracking?.root
    ? path.resolve(workspaceRoot, configFromFile.tracking.root)
    : workspaceRoot;

  return {
    workspaceRoot,
    tracking: {
      root: trackingRoot,
      schemaDir: configFromFile?.tracking?.schemaDir
        ? path.resolve(workspaceRoot, configFromFile.tracking.schemaDir)
        : path.join(trackingRoot, 'schema'),
      ticketsDir: configFromFile?.tracking?.ticketsDir
        ? path.resolve(workspaceRoot, configFromFile.tracking.ticketsDir)
        : path.join(trackingRoot, 'tickets'),
      backlogDir: configFromFile?.tracking?.backlogDir
        ? path.resolve(workspaceRoot, configFromFile.tracking.backlogDir)
        : path.join(trackingRoot, 'backlog'),
      sprintsDir: configFromFile?.tracking?.sprintsDir
        ? path.resolve(workspaceRoot, configFromFile.tracking.sprintsDir)
        : path.join(trackingRoot, 'sprints'),
    },
    metadata: {
      version: pkgVersion,
      generator: `stardate@${pkgVersion}`,
    },
  };
}

export interface LoadConfigOptions {
  cwd?: string;
}

export function loadConfig(options: LoadConfigOptions = {}): CliConfig {
  const cwd = options.cwd ?? process.cwd();
  const workspaceRoot = resolveWorkspaceRoot(cwd);

  const configFile = locateConfigFile(workspaceRoot);
  let loaded: Partial<CliConfig> | undefined;

  if (configFile) {
    const fileContent = fs.readFileSync(configFile, 'utf8');
    const parsed = YAML.parse(fileContent);
    if (parsed && isObject(parsed)) {
      loaded = parsed as Partial<CliConfig>;
    } else {
      logger.warn(`Ignoring invalid config at ${configFile}`);
    }
  }

  const pkgPath = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../..', 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version: string };

  return applyDefaults(workspaceRoot, loaded, pkg.version);
}

function locateConfigFile(startDir: string): string | undefined {
  let currentDir = startDir;
  while (true) {
    for (const candidate of CONFIG_FILE_CANDIDATES) {
      const filePath = path.join(currentDir, candidate);
      if (fs.existsSync(filePath)) {
        return filePath;
      }
    }
    const parent = path.dirname(currentDir);
    if (parent === currentDir) {
      break;
    }
    currentDir = parent;
  }
  const envConfig = process.env.STARDATE_CONFIG_PATH;
  if (envConfig && fs.existsSync(envConfig)) {
    return envConfig;
  }
  return undefined;
}
