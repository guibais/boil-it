jest.mock('execa', () => ({ execa: jest.fn() }));
jest.mock('ora', () => ({
  __esModule: true,
  default: () => ({
    start: () => ({ succeed: jest.fn(), fail: jest.fn() })
  })
}));

import { BoilIt } from '../boilit';
import fs from 'fs-extra';
import path from 'path';

describe('BoilIt', () => {
  let boilit: BoilIt;
  const testTempDir = path.join(process.cwd(), '.boilit-test-temp');

  beforeEach(() => {
    boilit = new BoilIt();
  });

  afterEach(async () => {
    await fs.remove(testTempDir);
  });

  describe('getRepoName', () => {
    it('should extract repository name from HTTPS URL', () => {
      const repoName = (boilit as any).getRepoName('https://github.com/username/repo-name.git');
      expect(repoName).toBe('repo-name');
    });

    it('should extract repository name from SSH URL', () => {
      const repoName = (boilit as any).getRepoName('git@github.com:username/repo-name.git');
      expect(repoName).toBe('repo-name');
    });

    it('should handle URLs without .git suffix', () => {
      const repoName = (boilit as any).getRepoName('https://github.com/username/repo-name');
      expect(repoName).toBe('repo-name');
    });
  });
});
