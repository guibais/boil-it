import fs from "fs-extra";
import path from "path";
import toml from "@iarna/toml";
import { BoilItConfig, BoilItConfigSchema, Module } from "./types";
import chalk from "chalk";
import { OperationCancelledError } from "./errors";

export class BoilIt {
  private tempDir = path.join(process.cwd(), ".boilit-temp");
  private config: BoilItConfig | null = null;
  private repoUrl: string = "";
  private repoName: string = "";

  public async use(
    repo: string,
    modules: string[] = [],
    options: { path?: string; ref?: string } = {}
  ) {
    const targetPath = options.path || ".";
    this.repoUrl = repo;
    this.repoName = this.getRepoName(repo);

    const { default: ora } = await import("ora");
    const spinner = ora("Fetching repository...").start();

    try {
      await this.setupTempDir();
      await this.cloneRepo(repo);
      await this.loadConfig();

      if (modules.length === 0) {
        modules = Object.keys(this.config?.modules || {});
      }

      await this.resolveAndApplyModules(modules, targetPath);
      spinner.succeed("Modules applied successfully!");
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      if (error instanceof OperationCancelledError) {
        spinner.info("Operation cancelled by user");
      } else {
        spinner.fail(`Failed to apply modules: ${errorMessage}`);
      }
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  private async resolveAndApplyModules(
    moduleNames: string[],
    targetPath: string
  ) {
    if (!this.config) {
      throw new Error("Configuration not loaded");
    }

    this.validateRequestedModules(moduleNames);
    const modulesToApply = this.resolveDependencies(moduleNames);
    const repoDir = path.join(this.tempDir, this.repoName);

    await this.validateModuleRefs(modulesToApply, repoDir);

    for (const moduleKey of modulesToApply) {
      const module = this.config.modules[moduleKey];
      if (!module) {
        throw new Error(`Module '${moduleKey}' not found in configuration`);
      }
      await this.applyModuleRefs(moduleKey, module, repoDir);
    }

    await this.copyToTarget(repoDir, targetPath, modulesToApply);
  }

  private validateRequestedModules(requestedModules: string[]) {
    if (!this.config) return;
    
    const availableModules = Object.keys(this.config.modules);
    const invalidModules: string[] = [];
    
    for (const moduleName of requestedModules) {
      if (!availableModules.includes(moduleName)) {
        invalidModules.push(moduleName);
      }
    }
    
    if (invalidModules.length > 0) {
      const suggestion = availableModules.length > 0 
        ? ` Available modules: ${availableModules.join(", ")}`
        : " No modules are defined in boilit.toml";
        
      throw new Error(
        `Invalid module${invalidModules.length > 1 ? 's' : ''} requested: ${invalidModules.join(", ")}.` +
        suggestion
      );
    }
  }

  private async validateModuleRefs(moduleNames: string[], repoDir: string) {
    if (!this.config) return;

    const execa = (await import("execa")).default;
    const { default: ora } = await import("ora");
    
    const spinner = ora("Validating module references...").start();
    
    try {
      await execa("git", ["-C", repoDir, "fetch", "--all"], { stdio: "pipe" });
    } catch (error: any) {
      spinner.fail("Failed to fetch repository references");
      throw new Error(`Failed to fetch repository references: ${error.message}`);
    }

    const invalidRefs: Array<{ module: string; ref: string }> = [];

    for (const moduleName of moduleNames) {
      const module = this.config.modules[moduleName];
      if (!module?.refs) continue;

      const originUrl = module.origin || this.config.default?.origin || this.repoUrl;

      for (const ref of module.refs) {
        const isValidRef = await this.checkRefExists(repoDir, ref, originUrl);
        if (!isValidRef) {
          invalidRefs.push({ module: moduleName, ref });
        }
      }
    }

    if (invalidRefs.length > 0) {
      spinner.fail("Invalid references found");
      const refList = invalidRefs.map(({ module, ref }) => `'${ref}' in module '${module}'`).join(", ");
      throw new Error(
        `Invalid reference${invalidRefs.length > 1 ? 's' : ''} found: ${refList}. ` +
        "These branches/commits/tags do not exist in the repository."
      );
    }

    spinner.succeed("All module references validated");
  }

  private async checkRefExists(repoDir: string, ref: string, originUrl?: string): Promise<boolean> {
    const execa = (await import("execa")).default;
    const url = originUrl || this.config?.default?.origin || this.repoUrl;
    try {
      // Fast check using ls-remote against the provided URL
      await execa("git", ["ls-remote", "--exit-code", url, ref], { stdio: "pipe" });
      return true;
    } catch {
      try {
        await execa("git", ["-C", repoDir, "rev-parse", "--verify", ref], { stdio: "pipe" });
        return true;
      } catch {
        return false;
      }
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

  private async applyModuleRefs(
    moduleKey: string,
    module: Module,
    repoDir: string
  ) {
    const { default: ora } = await import("ora");
    const spinner = ora(`Applying module: ${moduleKey}`).start();

    try {
      await this.prepareRepoForModule(repoDir, module);
      spinner.succeed(`Applied module: ${moduleKey}`);
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      if (error instanceof OperationCancelledError) {
        spinner.info(`Operation cancelled while applying module: ${moduleKey}`);
      } else {
        spinner.fail(`Failed to apply module ${moduleKey}: ${errorMessage}`);
      }
      throw error;
    }
  }

  private async copyToTarget(repoDir: string, targetPath: string, modulesToApply: string[]) {
    await fs.ensureDir(targetPath);

    const cfg = this.config;
    const defaultFiles = cfg?.default?.files;
    const defaultIgnore = cfg?.default?.ignore || [];

    const toCopy: Array<{ src: string; dest: string }> = [];
    const added = new Set<string>();

    const addCopies = async (
      includes: string[],
      ignores: string[],
      destBase: string
    ) => {
      const files = await this.collectFiles(repoDir, includes);
      const ignoreRegexes = (ignores || []).map((p) => this.globToRegExp(p));
      for (const abs of files) {
        const rel = path.relative(repoDir, abs).split(path.sep).join("/");
        if (ignoreRegexes.some((r) => r.test(rel))) continue;
        const dest = path.join(destBase, rel);
        const key = `${abs} -> ${dest}`;
        if (added.has(key)) continue;
        added.add(key);
        toCopy.push({ src: abs, dest });
      }
    };

    const anyModuleHasFiles = modulesToApply.some((m) => cfg?.modules[m]?.files && (cfg.modules[m]!.files as any).length > 0);

    if (defaultFiles && defaultFiles.length > 0) {
      await addCopies(defaultFiles, defaultIgnore || [], targetPath);
    }

    for (const name of modulesToApply) {
      const mod = cfg?.modules[name];
      if (!mod) continue;
      const includes = mod.files;
      if (includes && includes.length > 0) {
        const destBase = mod.path ? path.join(targetPath, mod.path) : targetPath;
        const ignores = [...(defaultIgnore || []), ...(mod.ignore || [])];
        await addCopies(includes, ignores, destBase);
      }
    }

    if (!defaultFiles && !anyModuleHasFiles) {
      // No include filters provided: copy everything (only apply default ignores if explicitly set)
      const all = await this.collectFiles(repoDir, ["**/*", "*"]);
      const ignoreRegexes = defaultIgnore && defaultIgnore.length > 0 ? defaultIgnore.map((p) => this.globToRegExp(p)) : [];
      for (const abs of all) {
        const rel = path.relative(repoDir, abs).split(path.sep).join("/");
        if (ignoreRegexes.length > 0 && ignoreRegexes.some((r) => r.test(rel))) continue;
        const dest = path.join(targetPath, rel);
        toCopy.push({ src: abs, dest });
      }
    }

    for (const { src, dest } of toCopy) {
      await fs.ensureDir(path.dirname(dest));
      await fs.copy(src, dest, { overwrite: true });
    }
  }

  private async loadConfig() {
    const configPath = path.join(this.tempDir, this.repoName, "boilit.toml");

    if (!(await fs.pathExists(configPath))) {
      throw new Error("boilit.toml not found in the repository");
    }

    const configContent = await fs.readFile(configPath, "utf-8");
    let configData;
    
    try {
      configData = toml.parse(configContent);
    } catch (error: any) {
      throw new Error(`Invalid TOML syntax in boilit.toml: ${error.message}`);
    }

    try {
      this.config = BoilItConfigSchema.parse(configData);
    } catch (error: any) {
      throw new Error(`Invalid boilit.toml configuration: ${error.message}`);
    }

    this.validateConfig();
  }

  private validateConfig() {
    if (!this.config) return;

    const moduleNames = Object.keys(this.config.modules);
    const duplicates = this.findDuplicates(moduleNames);
    
    if (duplicates.length > 0) {
      throw new Error(
        `Duplicate module names found in boilit.toml: ${duplicates.join(", ")}. ` +
        "Each module must have a unique name."
      );
    }

    for (const [moduleName, module] of Object.entries(this.config.modules)) {
      this.validateModule(moduleName, module, moduleNames);
    }
  }

  private validateModule(moduleName: string, module: Module, allModuleNames: string[]) {
    if (module.dependencies) {
      for (const dep of module.dependencies) {
        if (!allModuleNames.includes(dep)) {
          throw new Error(
            `Module '${moduleName}' has invalid dependency '${dep}'. ` +
            `Available modules: ${allModuleNames.join(", ")}`
          );
        }
        
        if (dep === moduleName) {
          throw new Error(
            `Module '${moduleName}' cannot depend on itself. ` +
            "Self-dependencies are not allowed."
          );
        }
      }

      const circularDep = this.detectCircularDependency(moduleName, module.dependencies, allModuleNames);
      if (circularDep) {
        throw new Error(
          `Circular dependency detected: ${circularDep.join(" → ")} → ${moduleName}. ` +
          "Dependencies must form a directed acyclic graph."
        );
      }
    }

    if (module.refs && module.refs.length === 0) {
      throw new Error(
        `Module '${moduleName}' has empty refs array. ` +
        "Either remove the refs field or provide at least one reference."
      );
    }

    if (module.files && module.files.length === 0) {
      throw new Error(
        `Module '${moduleName}' has empty files array. ` +
        "Either remove the files field or provide at least one file pattern."
      );
    }

    if (module.dependencies && module.dependencies.length === 0) {
      throw new Error(
        `Module '${moduleName}' has empty dependencies array. ` +
        "Either remove the dependencies field or provide at least one dependency."
      );
    }
  }

  private findDuplicates(array: string[]): string[] {
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    
    for (const item of array) {
      if (seen.has(item)) {
        duplicates.add(item);
      }
      seen.add(item);
    }
    
    return Array.from(duplicates);
  }

  private detectCircularDependency(
    moduleName: string, 
    dependencies: string[], 
    allModuleNames: string[],
    visited: Set<string> = new Set(),
    path: string[] = []
  ): string[] | null {
    if (visited.has(moduleName)) {
      const cycleStart = path.indexOf(moduleName);
      return cycleStart >= 0 ? path.slice(cycleStart) : path;
    }

    visited.add(moduleName);
    path.push(moduleName);

    for (const dep of dependencies) {
      if (!allModuleNames.includes(dep)) continue;
      
      const depModule = this.config?.modules[dep];
      if (depModule?.dependencies) {
        const cycle = this.detectCircularDependency(dep, depModule.dependencies, allModuleNames, visited, path);
        if (cycle) return cycle;
      }
    }

    visited.delete(moduleName);
    path.pop();
    return null;
  }

  private async cloneRepo(repo: string, force = false): Promise<string> {
    const repoName = this.getRepoName(repo);
    const targetDir = path.join(
      this.tempDir,
      force ? `temp-${Date.now()}` : repoName
    );

    try {
      const execa = (await import("execa")).default;
      await execa("git", ["clone", repo, targetDir], {
        stdio: "pipe",
      });
      return targetDir;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      throw new Error(`Failed to clone repository ${repo}: ${errorMessage}`);
    }
  }

  private async prepareRepoForModule(repoDir: string, module: Module) {
    const execa = (await import("execa")).default;
    if (!module.refs || module.refs.length === 0) return;

    await execa("git", ["-C", repoDir, "fetch", "--all"], { stdio: "pipe" });

    const originUrl = module.origin || this.config?.default?.origin || this.repoUrl;

    for (const ref of module.refs) {
      try {
        // Fetch the ref directly from the origin URL; tip will be in FETCH_HEAD
        await execa("git", ["-C", repoDir, "fetch", originUrl, ref], {
          stdio: "pipe",
        });
        const { stdout: current } = await execa(
          "git",
          ["-C", repoDir, "rev-parse", "HEAD"],
          { stdio: "pipe" }
        );
        const { stdout: base } = await execa(
          "git",
          ["-C", repoDir, "merge-base", current.trim(), `FETCH_HEAD`],
          { stdio: "pipe" }
        );
        const { stdout: revs } = await execa(
          "git",
          [
            "-C",
            repoDir,
            "rev-list",
            "--no-merges",
            "--reverse",
            `${base}..FETCH_HEAD`,
          ],
          { stdio: "pipe" }
        );
        const shas = revs.split("\n").filter(Boolean);
        if (shas.length > 0) {
          for (const sha of shas) {
            await this.cherryPickWithConflictHandling(repoDir, sha);
          }
          continue;
        }
      } catch {}
      // Fallback to applying the fetched tip directly
      await execa("git", ["-C", repoDir, "fetch", originUrl, ref], { stdio: "pipe" });
      await this.cherryPickWithConflictHandling(repoDir, `FETCH_HEAD`);
    }
  }

  private async cherryPickWithConflictHandling(repoDir: string, ref: string) {
    const execa = (await import("execa")).default;
    
    try {
      await execa("git", ["-C", repoDir, "cherry-pick", ref], {
        stdio: "pipe",
      });
    } catch (error: any) {
      if (error.exitCode === 1) {
        await this.handleMergeConflict(repoDir, ref);
      } else {
        throw error;
      }
    }
  }

  private async handleMergeConflict(repoDir: string, ref: string) {
    const inquirer = (await import("inquirer")).default;
    const execa = (await import("execa")).default;
    
    console.log(chalk.yellow(`\n⚠️  Merge conflict detected while cherry-picking ${ref}`));
    console.log(chalk.cyan("Please resolve the conflicts manually and then choose an option:"));
    
    while (true) {
      const { action } = await inquirer.prompt([
        {
          type: "list",
          name: "action",
          message: "What would you like to do?",
          choices: [
            { name: "Continue (conflicts resolved)", value: "continue" },
            { name: "Cancel (abort cherry-pick)", value: "cancel" }
          ]
        }
      ]);

      if (action === "cancel") {
        await execa("git", ["-C", repoDir, "cherry-pick", "--abort"], {
          stdio: "pipe",
        });
        throw new OperationCancelledError(`Cherry-pick cancelled by user for ${ref}`);
      }

      try {
        await execa("git", ["-C", repoDir, "cherry-pick", "--continue"], {
          stdio: "pipe",
        });
        console.log(chalk.green(`✔ Cherry-pick continued successfully for ${ref}`));
        break;
      } catch (error: any) {
        if (error.exitCode === 1) {
          console.log(chalk.red("❌ Conflicts still exist. Please resolve them before continuing."));
          continue;
        } else {
          throw error;
        }
      }
    }
  }

  private async collectFiles(
    root: string,
    patterns: string[]
  ): Promise<string[]> {
    const matches: string[] = [];
    const regexes = patterns.map((p) => this.globToRegExp(p));

    const walk = async (dir: string) => {
      const entries = await fs.readdir(dir);
      for (const entry of entries) {
        const full = path.join(dir, entry);
        const stat = await fs.stat(full);
        if (stat.isDirectory()) {
          if (entry === ".git") continue;
          await walk(full);
        } else {
          const rel = path.relative(root, full).split(path.sep).join("/");
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
    let p = pattern.replace(/\\/g, "/");
    // Protect double-star-dir "**/" and double-star "**" with placeholders
    p = p.replace(/\*\*\//g, "::DS_DIR::");
    p = p.replace(/\*\*/g, "::DS::");
    // Escape regex specials except '*' and '/'
    p = p.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    // Single star -> not crossing directory boundaries
    p = p.replace(/\*/g, "[^/]*");
    // Restore placeholders: '**/' may match zero or more directories, '**' any chars
    p = p.replace(/::DS_DIR::/g, "(?:.*/)?");
    p = p.replace(/::DS::/g, ".*");
    return new RegExp("^" + p + "$");
  }

  private getRepoName(repoUrl: string): string {
    const match = repoUrl.match(/\/([^/]+?)(\.git)?$/);
    if (!match) {
      throw new Error(`Invalid repository URL: ${repoUrl}`);
    }
    return match[1].replace(/\.git$/, "");
  }

  private async setupTempDir() {
    await fs.ensureDir(this.tempDir);
    await fs.emptyDir(this.tempDir);
  }

  private async cleanup() {
    await fs.remove(this.tempDir);
  }
}
