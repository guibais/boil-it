import chalk from 'chalk';
import { OperationCancelledError } from '../errors';

jest.mock('../boilit', () => {
  const state = { impl: jest.fn() };
  class BoilIt {
    use(...args: any[]) {
      return (state.impl as any)(...args);
    }
  }
  return { BoilIt, __state: state };
});

describe('CLI handleUse()', () => {
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  let handleUse: any;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.isolateModules(() => {
      // Re-require after mocks in this isolated module context
      handleUse = require('../cli').handleUse;
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('returns 0 on success', async () => {
    const use = jest.fn().mockResolvedValue(undefined);
    const code = await handleUse('https://x/y.git', [], { path: '.' }, { createBoilIt: () => ({ use } as any) });
    expect(use).toHaveBeenCalled();
    expect(code).toBe(0);
  });

  it('returns 0 on OperationCancelledError', async () => {
    const use = jest.fn().mockRejectedValue(new OperationCancelledError());
    const code = await handleUse('https://x/y.git', [], { path: '.' }, { createBoilIt: () => ({ use } as any) });
    expect(code).toBe(0);
    expect(logSpy).toHaveBeenCalledWith(chalk.yellow('Operation cancelled by user.'));
  });

  it('returns 1 on generic error', async () => {
    const use = jest.fn().mockRejectedValue(new Error('boom'));
    const code = await handleUse('https://x/y.git', [], { path: '.' }, { createBoilIt: () => ({ use } as any) });
    expect(code).toBe(1);
    expect(errorSpy).toHaveBeenCalled();
  });
});
