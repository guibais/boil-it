import fs from 'fs-extra';
import path from 'path';
import toml from '@iarna/toml';
import { BoilItConfig, BoilItConfigSchema, Module } from './types';
import chalk from 'chalk';

export class BoilIt {
  private tempDir = path.join(process.cwd(), '.boilit-temp');
  private config: BoilItConfig | null = null;
  private repoUrl: string = '';
  private repoName: string = '';

  public async use(repo: string, modules: string[] = [], options: { path?: string; ref?: string } = {}) {
    const targetPath = options.path || '.';
    this.repoUrl = repo;
    this.repoName = this.getRepoName(repo);

    const { default: ora } = await import('ora');
    const spinner = ora('Fetching repository...').start();

    try {
      await this.setupTempDir();
      await this.cloneRepo(repo);
      await this.loadConfig();
      
      if (modules.length === 0) {
        modules = Object.keys(this.config?.modules || {});
      }

      await this.resolveAndApplyModules(modules, targetPath);
      spinner.succeed('Modules applied successfully!');
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      spinner.fail(`Failed to apply modules: ${errorMessage}`);
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  private async resolveAndApplyModules(moduleNames: string[], targetPath: string) {
    if (!this.config) {
      throw new Error('Configuration not loaded');
    }

    const modulesToApply = this.resolveDependencies(moduleNames);
    
    for (const moduleKey of modulesToApply) {
      const module = this.config.modules[moduleKey];
      if (!module) {
        throw new Error(`Module '${moduleKey}' not found in configuration`);
      }
      await this.applyModule(moduleKey, module, targetPath);
    }
  }

  private resolveDependencies(moduleNames: string[]): string[] {
    if (!this.config) return [];
    
    const resolved = new Set<string>();
    
    const resolve = (moduleName: string) => {
      const module = this.config?.modules[moduleName];
      if (!module) return;
      
      if (module.dependencies) {
        for (const dep of module.dependencies) {
          if (!resolved.has(dep)) {
            resolve(dep);
          }
        }
      }
      
      resolved.add(moduleName);
    };
    
    for (const moduleName of moduleNames) {
      resolve(moduleName);
    }
    
    return Array.from(resolved);
  }

  private async applyModule(moduleKey: string, module: Module, targetPath: string) {
    const { default: ora } = await import('ora');
    const spinner = ora(`Applying module: ${moduleKey}`).start();
    
    try {
      const moduleRepo = module.origin || this.config?.default?.origin || this.repoUrl;
      
      let repoDir = path.join(this.tempDir, this.repoName);
      if (moduleRepo && moduleRepo !== this.repoUrl) {
        repoDir = await this.cloneRepo(moduleRepo, true);
      }

      await this.prepareRepoForModule(repoDir, module);

      const sourcePath = path.join(repoDir, module.path || '');
      
      const targetModulePath = path.join(targetPath, moduleKey);
      
      await fs.ensureDir(path.dirname(targetModulePath));
      if (module.files && module.files.length > 0) {
        const files = await this.collectFiles(sourcePath, module.files);
        for (const file of files) {
          const rel = path.relative(sourcePath, file);
          const dest = path.join(targetModulePath, rel);
          await fs.ensureDir(path.dirname(dest));
          await fs.copy(file, dest, { overwrite: true });
        }
      } else {
        await fs.copy(sourcePath, targetModulePath, { overwrite: true });
      }
      
      spinner.succeed(`Applied module: ${moduleKey}`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      spinner.fail(`Failed to apply module ${moduleKey}: ${errorMessage}`);
      throw error;
    }
  }

  private async loadConfig() {
    const configPath = path.join(this.tempDir, this.repoName, 'boilit.toml');
    
    if (!(await fs.pathExists(configPath))) {
      throw new Error('boilit.toml not found in the repository');
    }
    
    const configContent = await fs.readFile(configPath, 'utf-8');
    const configData = toml.parse(configContent);
    this.config = BoilItConfigSchema.parse(configData);
  }

  private async cloneRepo(repo: string, force = false): Promise<string> {
    const repoName = this.getRepoName(repo);
    const targetDir = path.join(this.tempDir, force ? `temp-${Date.now()}` : repoName);
    
    try {
      const execa = (await import('execa')).default;
      await execa('git', ['clone', '--depth', '1', repo, targetDir], {
        stdio: 'pipe',
      });
      return targetDir;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to clone repository ${repo}: ${errorMessage}`);
    }
  }

  private async prepareRepoForModule(repoDir: string, module: Module) {
    const execa = (await import('execa')).default;
    if (!module.refs || module.refs.length === 0) return;

    try {
      await execa('git', ['-C', repoDir, 'fetch', '--unshallow'], { stdio: 'pipe' });
    } catch {}
    await execa('git', ['-C', repoDir, 'fetch', '--all'], { stdio: 'pipe' });

    for (const ref of module.refs) {
      try {
        await execa('git', ['-C', repoDir, 'fetch', 'origin', ref], { stdio: 'pipe' });
        const { stdout: current } = await execa('git', ['-C', repoDir, 'rev-parse', 'HEAD'], { stdio: 'pipe' });
        const { stdout: base } = await execa('git', ['-C', repoDir, 'merge-base', current.trim(), `origin/${ref}`], { stdio: 'pipe' });
        const { stdout: revs } = await execa('git', ['-C', repoDir, 'rev-list', '--no-merges', '--reverse', `${base}..origin/${ref}`], { stdio: 'pipe' });
        const shas = revs.split('\n').filter(Boolean);
        if (shas.length > 0) {
          for (const sha of shas) {
            await execa('git', ['-C', repoDir, 'cherry-pick', sha], { stdio: 'pipe' });
          }
          continue;
        }
      } catch {}
      await execa('git', ['-C', repoDir, 'cherry-pick', ref], { stdio: 'pipe' });
    }
  }

  private async collectFiles(root: string, patterns: string[]): Promise<string[]> {
    const matches: string[] = [];
    const regexes = patterns.map((p) => this.globToRegExp(p));

    const walk = async (dir: string) => {
      const entries = await fs.readdir(dir);
      for (const entry of entries) {
        const full = path.join(dir, entry);
        const stat = await fs.stat(full);
        if (stat.isDirectory()) {
          await walk(full);
        } else {
          const rel = path.relative(root, full).split(path.sep).join('/');
          if (regexes.some((r) => r.test(rel))) {
            matches.push(full);
          }
        }
      }
    };

    await walk(root);
    return matches;
  }

  private globToRegExp(pattern: string): RegExp {
    let p = pattern.replace(/\\/g, '/');
    p = p.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    p = p.replace(/\*\*/g, '::DOUBLE_STAR::');
    p = p.replace(/\*/g, '[^/]*');
    p = p.replace(/::DOUBLE_STAR::/g, '.*');
    return new RegExp('^' + p + '$');
  }

  private getRepoName(repoUrl: string): string {
    const match = repoUrl.match(/\/([^/]+?)(\.git)?$/);
    if (!match) {
      throw new Error(`Invalid repository URL: ${repoUrl}`);
    }
    return match[1].replace(/\.git$/, '');
  }

  private async setupTempDir() {
    await fs.ensureDir(this.tempDir);
    await fs.emptyDir(this.tempDir);
  }

  private async cleanup() {
    await fs.remove(this.tempDir);
  }
}

