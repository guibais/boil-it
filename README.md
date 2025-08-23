# BoilIt 🔥

Decentralized boilerplate and module manager built on Git. BoilIt lets you bring code from a source repository into your project by applying module references (branches/tags/commits) in sequence, resolving dependencies, and guiding you through conflict resolution.

## Installation

- Development (local):
  ```bash
  npm install
  npm run build
  npm link
  ```

- Global (when published to npm):
  ```bash
  npm install -g boil-it
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

## Configuration (`boilit.toml`)

In the source repository, create a `boilit.toml` file at the root defining available modules and defaults. Real example (from the example repo below):

```toml
name = "example-repo"
description = "Example repository with modules"

[default]
origin = "origin" # global default remote name; modules can override with their own 'origin'

[modules.auth]
description = "Authentication module"
refs = ["auth-branch"]

[modules.user]
description = "User module"
refs = ["user-branch"]
dependencies = ["auth"]

[modules.payment]
description = "Payment module"
refs = ["payment-branch"]
dependencies = ["user"]
path = "custom-folder/payment"
files = ["modules/*.md"]

[modules.user2]
description = "User2 module with conflict"
refs = ["user2-branch"]

[modules.external]
description = "Module coming from an alternate remote"
origin = "upstream"        # per-module remote override
refs = ["external-feature"]
```

### Module options

- `description`: module description (optional)
- `refs`: array of Git references (branches, tags, or SHAs) applied in sequence (required to apply code)
- `dependencies`: other modules that must be applied first
- `path`: optional destination path where the module will be placed
- `files`: file glob(s) to include (e.g., `modules/*.md`)
- `origin`: optional remote name for this module (overrides `[default].origin`)

## How it works

1. Clone the provided repository and read `boilit.toml`.
2. Resolve module dependencies automatically and determine the apply order.
3. For each module, run a pipeline based on a `refs` array (branches, tags, or commits):
   - Fetch and resolve the chosen remote for each module (`[default].origin` or the module's `origin`).
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

- __Decentralized__: any Git repository with `boilit.toml` can serve as a module source.
- __Git-based__: leverages Git to fetch and apply module refs while preserving history where possible.
- __Refs pipeline__: `refs` define the order of commits/branches to compose a module.
- __Dependencies__: modules can depend on other modules; the order is automatically respected.

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
