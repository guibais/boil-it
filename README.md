# Boil It 🔥

A CLI tool for managing and cherry-picking modules from Git repositories.

## Installation

```bash
npm install -g boil-it
```

## Usage

### Basic Usage

```bash
boilit use <repository> [modules...]
```

### Examples

Use all modules from a repository:

```bash
boilit use https://github.com/your-username/example-repo.git
```

Use specific modules:

```bash
boilit use https://github.com/your-username/example-repo.git auth user
```

Specify a target directory:

```bash
boilit use https://github.com/your-username/example-repo.git --path ./my-project
```

## Configuration

Create a `boilit.toml` file in your repository root to define available modules:

```toml
name = "my-repo"
description = "My awesome repository with modules"

[modules.auth]
description = "Authentication module"
path = "modules/auth"
ref = "main"

[modules.user]
description = "User management module"
path = "modules/user"
ref = "main"
dependencies = ["auth"]  # This module depends on the auth module
```

### Module Configuration Options

- `name`: Module name (required)
- `description`: Module description (optional)
- `path`: Path to the module in the repository (required)
- `ref`: Git reference (branch, tag, or commit) (default: "main")
- `repo`: Custom repository URL (default: uses the main repository)
- `dependencies`: Array of module names that this module depends on

## How It Works

1. Clones the specified repository (or uses a local path)
2. Reads the `boilit.toml` configuration
3. Resolves module dependencies
4. Copies the specified modules to your target directory
5. Handles nested dependencies automatically

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

## Testing

```bash
npm test
```

## License

MIT
