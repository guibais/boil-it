#!/usr/bin/env node
import { Command } from 'commander';
import { BoilIt } from './boilit';
import { version } from '../package.json';
import chalk from 'chalk';

const program = new Command();

program
  .name('boilit')
  .description('A CLI tool for managing and cherry-picking modules from Git repositories')
  .version(version, '-v, --version', 'output the current version');

program
  .command('use <repo> [modules...]')
  .description('Use modules from a repository')
  .option('--path <path>', 'Path where to initialize the modules', '.')
  .option('--ref <ref>', 'Git reference (branch, tag, commit)')
  .action(async (repo, modules, options) => {
    try {
      const boilit = new BoilIt();
      await boilit.use(repo, modules, options);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      console.error(chalk.red(`Error: ${errorMessage}`));
      process.exit(1);
    }
  });

program.parse(process.argv);
