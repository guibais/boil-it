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
});
