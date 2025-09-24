import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { createLogger } from '../logger.js';

const CONFIG_FILE_CANDIDATES = ['houston.config.yaml', 'houston.config.yml'];

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
  git?: GitConfig;
  auth?: AuthConfig;
}

export interface GitConfig {
  autoCommit?: boolean;
  autoPush?: boolean | 'auto';
  autoPull?: boolean;
  pullRebase?: boolean;
}

export interface AuthConfig {
  github?: {
    host?: string;
    label?: string;
  };
}

export interface ConfigResolution {
  config?: CliConfig;
  configPath?: string;
  workspaceRoot?: string;
  source: 'filesystem' | 'env' | 'none';
  version: string;
}

export class WorkspaceConfigNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceConfigNotFoundError';
  }
}

const logger = createLogger();

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
      generator: `houston@${pkgVersion}`,
    },
    git: {
      autoCommit: configFromFile?.git?.autoCommit ?? true,
      autoPush: configFromFile?.git?.autoPush ?? 'auto',
      autoPull: configFromFile?.git?.autoPull ?? true,
      pullRebase: configFromFile?.git?.pullRebase ?? true,
    },
    auth: configFromFile?.auth,
  };
}

export interface LoadConfigOptions {
  cwd?: string;
}

export function loadConfig(options: LoadConfigOptions = {}): CliConfig {
  const resolution = resolveConfig(options);
  if (!resolution.config) {
    const startDir = fs.realpathSync(options.cwd ?? process.cwd());
    throw new WorkspaceConfigNotFoundError(
      `No Houston workspace detected from ${startDir}. Run this command inside a workspace or set HOUSTON_CONFIG_PATH.`,
    );
  }
  return resolution.config;
}

export function resolveConfig(options: LoadConfigOptions = {}): ConfigResolution {
  const startDir = fs.realpathSync(options.cwd ?? process.cwd());
  const located = locateConfigFile(startDir);
  const pkgVersion = readPackageVersion();

  if (!located) {
    return { version: pkgVersion, source: 'none' };
  }

  const fileContent = fs.readFileSync(located.configPath, 'utf8');
  let loaded: Partial<CliConfig> | undefined;
  const parsed = YAML.parse(fileContent);
  if (parsed && isObject(parsed)) {
    loaded = parsed as Partial<CliConfig>;
  } else {
    logger.warn(`Ignoring invalid config at ${located.configPath}`);
  }

  const workspaceRoot = located.workspaceRoot;
  const config = applyDefaults(workspaceRoot, loaded, pkgVersion);

  return {
    config,
    configPath: located.configPath,
    workspaceRoot,
    source: located.source,
    version: pkgVersion,
  };
}

interface ConfigFileLocation {
  configPath: string;
  workspaceRoot: string;
  source: 'filesystem' | 'env';
}

function locateConfigFile(startDir: string): ConfigFileLocation | undefined {
  let currentDir = startDir;
  while (true) {
    for (const candidate of CONFIG_FILE_CANDIDATES) {
      const filePath = path.join(currentDir, candidate);
      if (fs.existsSync(filePath)) {
        const resolvedPath = fs.realpathSync(filePath);
        const workspaceRoot = fs.realpathSync(path.dirname(resolvedPath));
        return {
          configPath: resolvedPath,
          workspaceRoot,
          source: 'filesystem',
        };
      }
    }
    const parent = path.dirname(currentDir);
    if (parent === currentDir) {
      break;
    }
    currentDir = parent;
  }
  const envConfig = process.env.HOUSTON_CONFIG_PATH;
  if (envConfig && fs.existsSync(envConfig)) {
    const resolvedPath = fs.realpathSync(envConfig);
    const workspaceRoot = fs.realpathSync(path.dirname(resolvedPath));
    return {
      configPath: resolvedPath,
      workspaceRoot,
      source: 'env',
    };
  }
  return undefined;
}

function readPackageVersion(): string {
  const pkgPath = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../..', 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version: string };
  return pkg.version;
}
