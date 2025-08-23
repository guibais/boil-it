#!/usr/bin/env node
import { Command } from 'commander';
import { BoilIt } from './boilit';
import { version } from '../package.json';
import chalk from 'chalk';
import { OperationCancelledError, isOperationCancelled } from './errors';

type UseOptions = { path?: string; ref?: string };
type Deps = { createBoilIt?: () => BoilIt };

export async function handleUse(repo: string, modules: string[], options: UseOptions, deps: Deps = {}): Promise<number> {
  try {
    const boilit = (deps.createBoilIt ? deps.createBoilIt() : new BoilIt());
    await boilit.use(repo, modules, options);
    return 0;
  } catch (error: unknown) {
    if (isOperationCancelled(error)) {
      console.log(chalk.yellow('Operation cancelled by user.'));
      return 0;
    }
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    console.error(chalk.red(`Error: ${errorMessage}`));
    return 1;
  }
}

export async function run(argv: string[]) {
  const program = new Command();

  program
    .name('boilit')
    .description('A CLI tool to apply module refs from Git repositories into your project')
    .version(version, '-v, --version', 'output the current version');

  program
    .command('use <repo> [modules...]')
    .description('Use modules from a repository')
    .option('--path <path>', 'Path where to initialize the modules', '.')
    .action(async (repo, modules, options) => {
      const code = await handleUse(repo, modules, options);
      process.exit(code);
    });

  await program.parseAsync(argv);
}

// Only auto-run when executed directly, not when imported for tests
if (require.main === module) {
  run(process.argv);
}
