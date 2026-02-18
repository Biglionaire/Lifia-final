# Devcontainer Configuration

This directory contains the configuration for GitHub Codespaces and VS Code devcontainers.

## What It Does

When you open this repository in a Codespace or devcontainer, it will automatically:

1. Set up a Node.js environment with LTS version
2. Install npm dependencies via `postCreateCommand`
3. Configure VS Code with recommended extensions:
   - ESLint for code linting
   - Prettier for code formatting

## Usage

### GitHub Codespaces

1. Click the "Code" button on the GitHub repository
2. Select the "Codespaces" tab
3. Click "Create codespace on main" (or your branch)
4. Wait for the container to build and start
5. Dependencies will be installed automatically
6. Start using the CLI: `npx tsx bin/acp.ts --help`

### VS Code Devcontainers

1. Install the "Remote - Containers" extension in VS Code
2. Open the repository in VS Code
3. Press F1 and select "Remote-Containers: Reopen in Container"
4. Wait for the container to build
5. Dependencies will be installed automatically

## Manual Setup

If you need to manually install dependencies:

```bash
npm install
```

Or use the quick-start script:

```bash
bash quick-start.sh
```

## Testing

After the devcontainer starts, you can run tests:

```bash
bash test-cli.sh
```

See [../TESTING.md](../TESTING.md) for more details.
