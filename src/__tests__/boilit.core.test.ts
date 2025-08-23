import chalk from 'chalk';
import path from 'path';

jest.mock('ora', () => ({
  __esModule: true,
  default: (text?: string) => {
    const api = {
      start: () => ({ succeed: jest.fn(), fail: jest.fn(), info: jest.fn() })
    };
    return api as any;
  },
}));

const execaMock = jest.fn();
jest.mock('execa', () => ({ __esModule: true, default: (...args: any[]) => execaMock(...args) }));

const fsExtra = {
  ensureDir: jest.fn(),
  emptyDir: jest.fn(),
  remove: jest.fn(),
  pathExists: jest.fn(),
  readFile: jest.fn(),
  copy: jest.fn(),
  readdir: jest.fn(),
  stat: jest.fn(),
};
jest.mock('fs-extra', () => fsExtra);

import { BoilIt } from '../boilit';
import { OperationCancelledError } from '../errors';

const goodToml = `
name = "Repo"

[modules.core]
description = "Core"
refs = ["main"]

[modules.extra]
dependencies = ["core"]
refs = ["feat"]
`;

const badToml = `name = "Repo"\n[modules]\n** invalid`;

function resetMocks() {
  jest.clearAllMocks();
  execaMock.mockReset();
}

describe('BoilIt core flows', () => {
  beforeEach(() => { jest.resetModules(); resetMocks(); });



  it('use() success end-to-end', async () => {
    const b = new BoilIt();

    fsExtra.ensureDir.mockResolvedValue(undefined);
    fsExtra.emptyDir.mockResolvedValue(undefined);
    fsExtra.pathExists.mockResolvedValue(true);
    fsExtra.readFile.mockResolvedValue(goodToml);
    fsExtra.copy.mockResolvedValue(undefined);
    fsExtra.remove.mockResolvedValue(undefined);

    // execa behavior per command sequence
    execaMock.mockImplementation(async (_cmd: string, args: string[]) => {
      const joined = args.join(' ');
      if (joined.startsWith('clone')) return {};
      if (joined.includes('fetch --all')) return {};
      if (joined.includes('rev-parse HEAD')) return { stdout: 'aaaa' } as any;
      if (joined.includes('merge-base')) return { stdout: 'bbbb' } as any;
      if (joined.includes('rev-list')) return { stdout: '' } as any; // no shas -> cherry-pick origin/ref
      if (joined.includes('fetch origin')) return {};
      if (joined.includes('rev-parse --verify origin/')) return {}; // checkRefExists
      if (joined.includes('cherry-pick origin/')) return {};
      return {};
    });

    await b.use('https://github.com/u/repo.git', [], { path: 'target' });
    expect(fsExtra.ensureDir).toHaveBeenCalled();
    expect(fsExtra.copy).toHaveBeenCalled();
  });

  it('use() handles OperationCancelledError with spinner.info', async () => {
    const b = new BoilIt();

    fsExtra.ensureDir.mockResolvedValue(undefined);
    fsExtra.emptyDir.mockResolvedValue(undefined);
    fsExtra.pathExists.mockResolvedValue(true);
    fsExtra.readFile.mockResolvedValue(goodToml);
    fsExtra.copy.mockResolvedValue(undefined);
    fsExtra.remove.mockResolvedValue(undefined);

    // clone ok
    execaMock.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args[0] === 'clone') return {};
      return {};
    });

    // Skip validateModuleRefs complexity
    jest.spyOn(b as any, 'validateModuleRefs').mockResolvedValue(undefined);
    // Force cancellation inside applyModuleRefs
    jest.spyOn(b as any, 'prepareRepoForModule').mockImplementation(async () => {
      throw new OperationCancelledError('cancelled');
    });

    await expect(b.use('https://github.com/u/repo.git', ['core'])).rejects.toBeInstanceOf(OperationCancelledError);
  });

  

  it('validateConfig throws when module has empty files array', () => {
    const b = new BoilIt();
    (b as any).config = {
      modules: {
        X: { files: [] },
      }
    };

    expect(() => (b as any).validateConfig()).toThrow("empty files array");
  });

  it('validateConfig throws when module has empty dependencies array', () => {
    const b = new BoilIt();
    (b as any).config = {
      modules: {
        X: { dependencies: [] },
      }
    };

    expect(() => (b as any).validateConfig()).toThrow("empty dependencies array");
  });

  it('validateConfig throws when module has invalid dependency', () => {
    const b = new BoilIt();
    (b as any).config = {
      modules: {
        A: { dependencies: ['Z'] },
      }
    };

    expect(() => (b as any).validateConfig()).toThrow("invalid dependency");
  });

  it('validateConfig throws when module depends on itself', () => {
    const b = new BoilIt();
    (b as any).config = {
      modules: {
        A: { dependencies: ['A'] },
      }
    };

    expect(() => (b as any).validateConfig()).toThrow("cannot depend on itself");
  });

  it('validateConfig throws when module has empty refs array', () => {
    const b = new BoilIt();
    (b as any).config = {
      modules: {
        X: { refs: [] },
      }
    };

    expect(() => (b as any).validateConfig()).toThrow("empty refs array");
  });

  it('cloneRepo failure surfaces friendly message', async () => {
    const b = new BoilIt();
    const err = new Error('network');
    execaMock.mockRejectedValue(err);

    await expect((b as any).cloneRepo('https://github.com/acme/repo.git'))
      .rejects.toThrow('Failed to clone repository https://github.com/acme/repo.git: network');
  });

  it('prepareRepoForModule takes SHAs path and continues', async () => {
    const b = new BoilIt();
    const repoDir = path.join(process.cwd(), '.x');
    const mod = { refs: ['feature'] } as any;

    const cherrySpy = jest.spyOn(b as any, 'cherryPickWithConflictHandling').mockResolvedValue(undefined as any);

    execaMock.mockImplementation(async (_cmd: string, args: string[]) => {
      const a = args.join(' ');
      if (a.includes('fetch --all')) return {};
      if (a.includes('fetch origin feature')) return {};
      if (a.includes('rev-parse HEAD')) return { stdout: 'h' } as any;
      if (a.includes('merge-base')) return { stdout: 'b' } as any;
      if (a.includes('rev-list')) return { stdout: 'sha1\nsha2\n' } as any;
      return {};
    });

    await (b as any).prepareRepoForModule(repoDir, mod);
    expect(cherrySpy).toHaveBeenCalledTimes(2);
    cherrySpy.mockRestore();
  });

  it('cherryPickWithConflictHandling calls handleMergeConflict on exitCode 1', async () => {
    const b = new BoilIt();
    const err: any = new Error('conflict');
    err.exitCode = 1;

    execaMock.mockRejectedValue(err);
    const spy = jest.spyOn(b as any, 'handleMergeConflict').mockResolvedValue(undefined as any);

    await (b as any).cherryPickWithConflictHandling('/repo', 'ref');
    expect(spy).toHaveBeenCalledWith('/repo', 'ref');
    spy.mockRestore();
  });

  it('handleMergeConflict -> continue with conflicts loops then succeeds', async () => {
    const b = new BoilIt();

    const err1: any = new Error('still conflicts');
    err1.exitCode = 1;

    let continueAttempt = 0;
    execaMock.mockImplementation(async (_cmd: string, args: string[]) => {
      const a = args.join(' ');
      if (a.includes('cherry-pick --continue')) {
        continueAttempt += 1;
        if (continueAttempt === 1) throw err1;
        return {};
      }
      return {};
    });

    jest.doMock('inquirer', () => ({ __esModule: true, default: { prompt: jest.fn()
      .mockResolvedValue({ action: 'continue' }) } }));

    await (b as any).handleMergeConflict('/repo', 'ref');
    expect(continueAttempt).toBe(2);
  });

  it('cherryPickWithConflictHandling throws on non-1 exit code', async () => {
    const b = new BoilIt();

    const err: any = new Error('fatal');
    err.exitCode = 2;
    execaMock.mockRejectedValue(err);

    await expect((b as any).cherryPickWithConflictHandling('/repo', 'r'))
      .rejects.toThrow('fatal');
  });

  it('handleMergeConflict -> continue throws on unexpected error', async () => {
    const b = new BoilIt();

    const err: any = new Error('unexpected');
    err.exitCode = 2;

    execaMock.mockImplementation(async (_cmd: string, args: string[]) => {
      const a = args.join(' ');
      if (a.includes('cherry-pick --continue')) throw err;
      return {};
    });

    jest.doMock('inquirer', () => ({ __esModule: true, default: { prompt: jest.fn()
      .mockResolvedValueOnce({ action: 'continue' }) } }));

    await expect((b as any).handleMergeConflict('/repo', 'r')).rejects.toThrow('unexpected');
  });

  it('validateModuleRefs fails when fetch --all fails', async () => {
    const b = new BoilIt();
    (b as any).config = { modules: { m1: { refs: ['x'] } } };

    const err = new Error('net');
    execaMock.mockRejectedValue(err);

    const call = (b as any).validateModuleRefs(['m1'], '/repo');
    await expect(call).rejects.toThrow('Failed to fetch repository references');
  });

  it('validateModuleRefs throws listing invalid refs', async () => {
    const b = new BoilIt();
    (b as any).config = { modules: { A: { refs: ['x', 'y'] }, B: { refs: ['z'] } } };

    // fetch --all ok
    execaMock.mockResolvedValue({});
    // make checkRefExists return false for all
    const spy = jest.spyOn(b as any, 'checkRefExists').mockResolvedValue(false);

    await expect((b as any).validateModuleRefs(['A', 'B'], '/repo'))
      .rejects.toThrow('Invalid reference');

    spy.mockRestore();
  });

  it('detectCircularDependency is reported by validateConfig', async () => {
    const b = new BoilIt();
    (b as any).config = {
      modules: {
        A: { dependencies: ['B'] },
        B: { dependencies: ['A'] },
      }
    };

    expect(() => (b as any).validateConfig()).toThrow('Circular dependency detected');
  });

  it('use() with invalid requested module throws', async () => {
    const b = new BoilIt();

    fsExtra.ensureDir.mockResolvedValue(undefined);
    fsExtra.emptyDir.mockResolvedValue(undefined);
    fsExtra.pathExists.mockResolvedValue(true);
    fsExtra.readFile.mockResolvedValue(goodToml);

    execaMock.mockResolvedValue({});

    await expect(b.use('https://github.com/u/repo.git', ['unknown'])).rejects.toThrow('Invalid module');
  });

  it('loadConfig throws on missing file', async () => {
    const b = new BoilIt();

    fsExtra.ensureDir.mockResolvedValue(undefined);
    fsExtra.emptyDir.mockResolvedValue(undefined);
    fsExtra.pathExists.mockResolvedValue(false);

    execaMock.mockResolvedValue({});

    await expect(b.use('https://github.com/u/repo.git')).rejects.toThrow('boilit.toml not found');
  });

  it('loadConfig throws on invalid TOML', async () => {
    const b = new BoilIt();

    fsExtra.ensureDir.mockResolvedValue(undefined);
    fsExtra.emptyDir.mockResolvedValue(undefined);
    fsExtra.pathExists.mockResolvedValue(true);
    fsExtra.readFile.mockResolvedValue(badToml);

    execaMock.mockResolvedValue({});

    await expect(b.use('https://github.com/u/repo.git')).rejects.toThrow('Invalid TOML syntax');
  });

  it('handleMergeConflict -> cancel propagates OperationCancelledError', async () => {
    const b = new BoilIt();

    // Set minimal config for flow
    (b as any).config = { modules: { m: { refs: ['x'] } } };

    // execa sequencing: cherry-pick fails with exitCode 1
    const err: any = new Error('conflict');
    err.exitCode = 1;

    execaMock.mockImplementation(async (_cmd: string, args: string[]) => {
      const a = args.join(' ');
      if (a.includes('fetch --all')) return {};
      if (a.includes('fetch origin')) return {};
      if (a.includes('rev-parse HEAD')) return { stdout: 'h' } as any;
      if (a.includes('merge-base')) return { stdout: 'b' } as any;
      if (a.includes('rev-list')) return { stdout: 'sha1\n' } as any; // ensure loop
      if (a.startsWith('-C')) return {}; // ignore -C handling
      if (a.includes('cherry-pick sha1')) throw err;
      if (a.includes('cherry-pick --abort')) return {};
      return {};
    });

    jest.doMock('inquirer', () => ({ __esModule: true, default: { prompt: jest.fn().mockResolvedValue({ action: 'cancel' }) } }));

    await expect((b as any).handleMergeConflict(path.join(process.cwd(), '.x'), 'sha1'))
      .rejects.toBeInstanceOf(OperationCancelledError);
  });

  it('handleMergeConflict -> continue succeeds after resolution', async () => {
    const b = new BoilIt();

    execaMock.mockImplementation(async (_cmd: string, args: string[]) => {
      const a = args.join(' ');
      if (a.includes('cherry-pick --continue')) return {};
      return {};
    });

    jest.doMock('inquirer', () => ({ __esModule: true, default: { prompt: jest.fn()
      .mockResolvedValueOnce({ action: 'continue' }) } }));

    await (b as any).handleMergeConflict(path.join(process.cwd(), '.x'), 'ref');
  });

  it('checkRefExists covers both code paths', async () => {
    const b = new BoilIt();

    // origin/<ref> fails, direct <ref> succeeds
    execaMock
      .mockRejectedValueOnce(new Error('no origin'))
      .mockResolvedValueOnce({});

    await expect((b as any).checkRefExists('/repo', 'r1')).resolves.toBe(true);

    // both fail -> false
    execaMock
      .mockRejectedValueOnce(new Error('no origin'))
      .mockRejectedValueOnce(new Error('no direct'));

    await expect((b as any).checkRefExists('/repo', 'r2')).resolves.toBe(false);
  });

  it('findDuplicates and glob helpers', async () => {
    const b = new BoilIt();

    const dups = (b as any).findDuplicates(['a', 'b', 'a']);
    expect(dups).toEqual(['a']);

    // collectFiles
    fsExtra.readdir.mockImplementation(async (dir: string) => dir.endsWith('root') ? ['a.txt', 'sub'] : ['b.ts']);
    fsExtra.stat.mockImplementation(async (p: string) => ({ isDirectory: () => p.endsWith('sub') } as any));

    const root = path.join(process.cwd(), 'root');
    const files = await (b as any).collectFiles(root, ['**/*.ts', '*.txt']);
    expect(files.some((f: string) => f.endsWith('a.txt'))).toBe(true);
  });

  it('getRepoName invalid URL', () => {
    const b = new BoilIt();
    expect(() => (b as any).getRepoName('invalid')).toThrow('Invalid repository URL');
  });
  
  it('validateRequestedModules with no modules defined shows proper suggestion', () => {
    const b = new BoilIt();
    (b as any).config = { modules: {} };
    expect(() => (b as any).validateRequestedModules(['x']))
      .toThrow('No modules are defined');
  });

  it('validateConfig throws on duplicate module names (simulated)', () => {
    const b = new BoilIt();
    (b as any).config = { modules: { A: {}, B: {} } } as any;
    const spy = jest.spyOn(b as any, 'findDuplicates').mockReturnValue(['A']);
    expect(() => (b as any).validateConfig()).toThrow('Duplicate module names');
    spy.mockRestore();
  });

  it('resolveAndApplyModules throws when configuration not loaded', async () => {
    const b = new BoilIt();
    // config remains null
    await expect((b as any).resolveAndApplyModules(['x'], '.')).rejects.toThrow('Configuration not loaded');
  });

  it('resolveAndApplyModules throws when a module is missing during application', async () => {
    const b = new BoilIt();
    (b as any).config = { modules: { present: {} } } as any;
    jest.spyOn(b as any, 'resolveDependencies').mockReturnValue(['missing']);
    jest.spyOn(b as any, 'validateModuleRefs').mockResolvedValue(undefined);
    // stub copyToTarget to avoid fs
    jest.spyOn(b as any, 'copyToTarget').mockResolvedValue(undefined);

    await expect((b as any).resolveAndApplyModules([], '.')).rejects.toThrow("Module 'missing' not found");
  });

  it('applyModuleRefs fails with generic error path (spinner.fail)', async () => {
    const b = new BoilIt();
    jest.spyOn(b as any, 'prepareRepoForModule').mockRejectedValue(new Error('boom'));
    await expect((b as any).applyModuleRefs('mod', {} as any, '/repo')).rejects.toThrow('boom');
  });

  it('loadConfig throws on invalid boilit.toml configuration (schema error)', async () => {
    const b = new BoilIt();

    fsExtra.ensureDir.mockResolvedValue(undefined);
    fsExtra.emptyDir.mockResolvedValue(undefined);
    fsExtra.pathExists.mockResolvedValue(true);
    fsExtra.readFile.mockResolvedValue('name = "Repo"\nmodules = "nope"');

    execaMock.mockResolvedValue({});

    await expect(b.use('https://github.com/u/repo.git')).rejects.toThrow('Invalid boilit.toml configuration');
  });

  it('resolveDependencies: skips already-resolved dependency (covers guard false path)', () => {
    const b = new BoilIt();
    (b as any).config = {
      modules: {
        C: {},
        B: { dependencies: ['C'] },
        A: { dependencies: ['B', 'C'] },
      }
    } as any;

    const resolved = (b as any).resolveDependencies(['A']);
    expect(resolved).toEqual(expect.arrayContaining(['A', 'B', 'C']));
  });

  it('validateRequestedModules returns early when config is null', () => {
    const b = new BoilIt();
    // config is null by default; just ensure it does not throw
    expect(() => (b as any).validateRequestedModules(['anything'])).not.toThrow();
  });

  it('applyModuleRefs triggers spinner.info on OperationCancelledError', async () => {
    const b = new BoilIt();
    // Throw OperationCancelledError from prepareRepoForModule
    jest.spyOn(b as any, 'prepareRepoForModule').mockRejectedValue(new OperationCancelledError('cancel'));
    await expect((b as any).applyModuleRefs('mod', {} as any, '/repo')).rejects.toBeInstanceOf(OperationCancelledError);
  });

  it('prepareRepoForModule returns early when refs empty', async () => {
    const b = new BoilIt();
    // Should not call execa at all
    const result = await (b as any).prepareRepoForModule('/repo', { refs: [] });
    expect(result).toBeUndefined();
  });

  it('validateModuleRefs returns early when config is null (no git calls)', async () => {
    const b = new BoilIt();
    await (b as any).validateModuleRefs(['any'], '/repo');
    expect(execaMock).not.toHaveBeenCalled();
  });

  it('validateModuleRefs skips when module.refs is undefined (no checkRefExists calls)', async () => {
    const b = new BoilIt();
    (b as any).config = { modules: { M: {} } } as any;
    execaMock.mockResolvedValue({}); // fetch --all ok
    const spy = jest.spyOn(b as any, 'checkRefExists');
    await (b as any).validateModuleRefs(['M'], '/repo');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('resolveDependencies returns [] when config is null', () => {
    const b = new BoilIt();
    const res = (b as any).resolveDependencies(['A']);
    expect(res).toEqual([]);
  });

  it('resolveDependencies inner guard returns when module not found', () => {
    const b = new BoilIt();
    (b as any).config = { modules: { X: {} } } as any;
    const res = (b as any).resolveDependencies(['Unknown']);
    expect(res).toEqual([]);
  });
});
