# BoilIt 🔥

Decentralized boilerplate and module manager built on Git. BoilIt lets you bring code from a source repository into your project by applying module references (branches/tags/commits) in sequence, resolving dependencies, and guiding you through conflict resolution.

## Installation

- Global (via npm):

  ```bash
  npm install -g boilit
  ```

- Development (local):
  ```bash
  npm install
  npm run build
  npm link
  ```

## Usage

### Main command

```bash
boilit use <repo> [modules...] [--path <target>]
```

- `<repo>`: source Git repository URL (HTTPS/SSH) containing `boilit.toml`.
- `[modules...]`: list of modules to apply. If empty, applies all modules from the repository.
- `--path <target>`: target directory (default: `.`).

### Examples

- Apply all modules:

  ```bash
  boilit use https://github.com/guibais/boil-test-repo.git
  ```

- Apply only `auth` and `user` into a specific directory:
  ```bash
  boilit use https://github.com/guibais/boil-test-repo.git auth user --path ./my-project
  ```

### Simple examples

- __Apply everything into the current directory__
  ```bash
  boilit use https://github.com/guibais/boil-test-repo.git
  ```

- __Apply a single module__
  ```bash
  boilit use https://github.com/guibais/boil-test-repo.git auth
  ```

- __Apply multiple modules into a destination folder__
  ```bash
  boilit use https://github.com/guibais/boil-test-repo.git user payment --path ./dest
  ```

- __Use mixed refs (branch, commit, tag) defined in `boilit.toml`__
  ```toml
  [modules.api]
  refs = ["feature/api", "d34db33f", "v1.2.3"]
  ```
  ```bash
  boilit use https://github.com/guibais/boil-test-repo.git api
  ```

- __Honor file globs__ (e.g., `[default].files` and `ignore` in `boilit.toml`)
  ```toml
  [default]
  files = ["**/*.md"]
  ignore = ["**/drafts/**"]
  ```
  ```bash
  boilit use https://github.com/guibais/boil-test-repo.git
  ```

## Configuration (`boilit.toml`)

In the source repository, create a `boilit.toml` file at the root defining available modules and defaults. Real example (from the example repo below):

```toml
name = "example-repo"
description = "Example repository with modules"

[default]
origin = "https://github.com/your-org/your-repo.git" # global default Git remote URL; modules can override with their own 'origin'
# Optional: restrict what gets copied globally
# Without 'files', BoilIt copies everything
files = ["**/*.md"]
# Optional: exclude patterns (only applied when explicitly set)
ignore = ["**/drafts/**", "**/skip.md"]

[modules.auth]
description = "Authentication module"
refs = ["auth-branch"]

[modules.user]
description = "User module"
refs = ["user-branch", "a1b2c3", "hotfix-tag", "another-branch"]
# dependecies (optional) means "apply this module only after the dependencies are applied"
dependencies = ["auth"]

[modules.payment]
description = "Payment module"
refs = ["payment-branch"]
dependencies = ["user"]
path = "custom-folder/payment"
files = ["modules/*.md"]
# Exclude some files from this module only
ignore = ["modules/secret.md"]

[modules.user2]
description = "User2 module with conflict"
refs = ["user2-branch"]

[modules.external]
description = "Module coming from an alternate remote"
origin = "git@github.com:another/repo.git"  # per-module Git remote URL override
refs = ["external-feature"]
```

### Module options

- `description`: module description (optional)
- `refs`: array of Git references applied em sequência; você pode misturar múltiplas branches, tags e commits (SHAs)
- `dependencies`: other modules that must be applied first
- `path`: optional destination path where the module will be placed
- `files`: file glob(s) to include (e.g., `modules/*.md`)
- `ignore`: file glob(s) to exclude for this module
- `origin`: optional Git remote URL for this module (overrides `[default].origin`). If omitted, BoilIt uses `[default].origin` when present, otherwise the source repo URL passed to the CLI.

Additionally, in `[default]` you can define:

- `files`: global include globs applied as a baseline to all modules
- `ignore`: global exclude globs applied to all copied files

### File selection semantics

- If `[default].files` is provided, those files are included globally (subject to `[default].ignore` if set).
- If a module defines `files`, they are included into its destination (subject to `[default].ignore` and the module's `ignore` if set). If `path` is set, copies land under that subfolder.
- Both default-level and module-level `ignore` accept one or more glob patterns (`*`, `**`, etc.).
- If neither default-level nor any module defines `files`, BoilIt copies everything from the source repo. `[default].ignore` is only applied if explicitly set.
- The `.git` directory is always skipped.

## How it works

1. Clone the provided repository and read `boilit.toml`.
2. Resolve module dependencies automatically and determine the apply order.
3. For each module, run a pipeline based on a `refs` array (branches, tags, or commits):
   - Fetch and resolve the chosen remote URL for each module (`[default].origin` or the module's `origin`; falls back to the CLI source repo URL).
   - Expand each `ref` into one or more underlying revisions to apply, then apply them in order.
   - If needed, fall back to `<remote>/<ref>` when appropriate.
4. If a conflict occurs while applying a ref, BoilIt guides you to resolve it manually and choose to continue or cancel.
5. Finally, it reports success or failure and cleans up the temporary directory.

## Conflict resolution

If a conflict occurs while applying a ref, BoilIt pauses and shows interactive options:

1. Resolve conflicts in the indicated files (git status/merge markers).
2. In the prompt:
   - "Continue (conflicts resolved)" → continue the application of the remaining refs.
   - "Cancel (abort)" → abort the current application and stop the execution.

Tip: the example repository has the `user2-branch` which typically causes a conflict so you can test the flow.

## Cancellation

- You can cancel at any time (e.g., via `Ctrl+C` or by choosing "Cancel" in the conflict prompt).
- BoilIt handles cancellations globally, aborts ongoing operations (like `cherry-pick --abort` when applicable), and performs proper cleanup.

## Example repository

- https://github.com/guibais/boil-test-repo

Try it:

```bash
boilit use https://github.com/guibais/boil-test-repo.git auth user
boilit use https://github.com/guibais/boil-test-repo.git payment --path ./dest
boilit use https://github.com/guibais/boil-test-repo.git user2   # conflict flow
```

Key characteristics:

- **Decentralized**: any Git repository with `boilit.toml` can serve as a module source.
- **Git-based**: leverages Git to fetch and apply module refs while preserving history where possible.
- **Refs pipeline**: `refs` define the order of commits/branches to compose a module.
- **Dependencies**: modules can depend on other modules; the order is automatically respected.

## Development

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build the project:
   ```bash
   npm run build
   ```
4. Link the package globally:
   ```bash
   npm link
   ```

## Tests

```bash
npm test
```

## License

MIT

## Release & Publish

- Merges to `main`/`master` trigger the GitHub Actions workflow at `.github/workflows/ci.yml`.
- The workflow runs tests on Node 18 and 20, then publishes to npm on successful push to `main`/`master`.
- Required secret: `NPM_TOKEN` with publish access.
- Package name: `boilit`. Install globally with:
  ```bash
  npm install -g boilit
  ```
