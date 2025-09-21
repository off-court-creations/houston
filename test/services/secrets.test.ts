import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/interactive.js', () => ({
  canPrompt: vi.fn(),
  promptSecret: vi.fn(),
}));

const interactive = await import('../../src/lib/interactive.js');
const canPromptMock = interactive.canPrompt as vi.MockedFunction<typeof interactive.canPrompt>;
const promptSecretMock = interactive.promptSecret as vi.MockedFunction<typeof interactive.promptSecret>;

const secrets = await import('../../src/services/secrets.js');

describe('secrets passphrase flow', () => {
  const existsSpy = vi.spyOn(fs, 'existsSync');
  const mkdirSpy = vi.spyOn(fs, 'mkdirSync');
  const writeSpy = vi.spyOn(fs, 'writeFileSync');
  const readSpy = vi.spyOn(fs, 'readFileSync');

  beforeEach(() => {
    process.env.HOUSTON_PASSPHRASE = '';
    canPromptMock.mockReturnValue(true);
    existsSpy.mockReturnValue(false);
    mkdirSpy.mockImplementation(() => undefined);
    writeSpy.mockImplementation(() => undefined);
    readSpy.mockImplementation(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });
  });

  afterEach(() => {
    delete process.env.HOUSTON_PASSPHRASE;
    vi.resetAllMocks();
  });

  it('prompts until matching passphrases before encrypting', async () => {
    promptSecretMock
      .mockResolvedValueOnce('secret-one')
      .mockResolvedValueOnce('mismatch')
      .mockResolvedValueOnce('secret-two')
      .mockResolvedValueOnce('secret-two');

    await secrets.setSecret('svc', 'acct', 'value');

    expect(promptSecretMock).toHaveBeenCalledTimes(4);
    expect(promptSecretMock.mock.calls[0]?.[0]).toContain('Create passphrase');
    expect(promptSecretMock.mock.calls[1]?.[0]).toContain('Confirm passphrase');
    expect(promptSecretMock.mock.calls[2]?.[0]).toContain('Create passphrase');
    expect(promptSecretMock.mock.calls[3]?.[0]).toContain('Confirm passphrase');
    expect(writeSpy).toHaveBeenCalled();
  });

  it('requires confirmation when establishing a new passphrase from getSecret', async () => {
    promptSecretMock
      .mockResolvedValueOnce('secret-three')
      .mockResolvedValueOnce('secret-three');

    const result = await secrets.getSecret('svc', 'acct');

    expect(result).toBeNull();
    expect(promptSecretMock).toHaveBeenCalledTimes(2);
    expect(promptSecretMock.mock.calls[0]?.[0]).toContain('Set passphrase');
    expect(promptSecretMock.mock.calls[1]?.[0]).toContain('Confirm passphrase');
  });

  it('confirms passphrase when storing new secret with existing entries', async () => {
    existsSpy.mockReturnValue(true);
    readSpy.mockReturnValue(
      JSON.stringify({ v: 1, entries: { 'svc:existing': { salt: 'c2FsdA==', iv: 'aXY=', data: 'ZGF0YQ==' } } }),
    );
    promptSecretMock
      .mockResolvedValueOnce('secret-four')
      .mockResolvedValueOnce('secret-four');

    await secrets.setSecret('svc', 'acct', 'value');

    expect(promptSecretMock).toHaveBeenCalledTimes(2);
    expect(promptSecretMock.mock.calls[0]?.[0]).toContain('Enter passphrase to decrypt secrets');
    expect(promptSecretMock.mock.calls[1]?.[0]).toContain('Confirm passphrase');
  });
});
