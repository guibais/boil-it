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

  it('uses default BoilIt when deps.createBoilIt is not provided (success path)', async () => {
    const { __state } = require('../boilit');
    __state.impl.mockResolvedValue(undefined);
    const code = await handleUse('https://x/y.git', [], { path: '.' });
    expect(code).toBe(0);
  });

  it('returns 1 on non-Error thrown (unknown error message path)', async () => {
    const code = await handleUse('https://x/y.git', [], { path: '.' }, { createBoilIt: () => ({ use: () => Promise.reject('nope') } as any) });
    expect(code).toBe(1);
    expect(errorSpy.mock.calls[0][0]).toContain('An unknown error occurred');
  });
});

describe('CLI run()', () => {
  let run: any;
  let exitSpy: jest.SpyInstance;
  let state: any;

  beforeEach(() => {
    // get access to BoilIt mock state
    state = require('../boilit').__state;
    jest.isolateModules(() => {
      const mod = require('../cli');
      run = mod.run;
    });
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new Error(`exit:${code}`); }) as any);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('parses args and exits with code 0 on success', async () => {
    state.impl.mockResolvedValue(undefined);
    try {
      await run(['node', 'cli', 'use', 'https://x/y.git', 'm1', 'm2', '--path', 'tgt']);
    } catch (e: any) {
      expect(e.message).toBe('exit:0');
    }
  });

  it('exits with code 1 when BoilIt.use rejects with error', async () => {
    state.impl.mockRejectedValue(new Error('boom'));
    try {
      await run(['node', 'cli', 'use', 'https://x/y.git']);
    } catch (e: any) {
      expect(e.message).toBe('exit:1');
    }
  });
});
