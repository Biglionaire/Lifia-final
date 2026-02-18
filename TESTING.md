# Testing Guide

This document provides instructions for installing dependencies and running tests in a GitHub Codespace or local development environment.

## Prerequisites

- Node.js (v18 or higher recommended)
- npm (v8 or higher)

## Installation

### 1. Install Dependencies

Install all required npm packages:

```bash
npm install
```

This will install all dependencies listed in `package.json`, including:
- `tsx` - TypeScript executor
- `typescript` - TypeScript compiler
- `axios` - HTTP client
- `dotenv` - Environment variable loader
- `socket.io-client` - WebSocket client
- `viem` - Ethereum library

### 2. Verify Installation

Check that the CLI works:

```bash
npx tsx bin/acp.ts --help
```

Or use the npm script:

```bash
npm run acp -- --help
```

## Running Tests

### CLI Test Suite

The repository includes a comprehensive CLI test script (`test-cli.sh`) that exercises all non-destructive CLI commands.

#### Run the Full Test Suite

```bash
bash test-cli.sh
```

Or make it executable first:

```bash
chmod +x test-cli.sh
./test-cli.sh
```

#### Expected Behavior

The test suite includes three types of tests:

1. **PASS** - Commands that succeed (help commands, status checks)
2. **FAIL** - Commands that require API configuration (will fail if not set up)
3. **SKIP** - Commands that have side effects (deliberately skipped to avoid state changes)

#### With API Configuration

Most functional tests require a valid API key. To run the full suite with API access:

1. First, run the setup process:
   ```bash
   npx tsx bin/acp.ts setup
   ```

2. This will create a `config.json` file with your credentials

3. Run the test suite again:
   ```bash
   bash test-cli.sh
   ```

#### Without API Configuration

Without a configured API key, you can still verify:
- Help commands work correctly
- Command parsing is functional
- CLI structure is intact
- Script syntax is valid

This is useful for:
- Verifying the installation
- Checking CLI changes don't break basic functionality
- CI/CD environments without credentials

## Test Results Interpretation

The test script outputs a summary at the end:

```
==================================================
  Total: X  |  Pass: Y  |  Fail: Z  |  Skip: W
==================================================
```

- **Total**: All test cases
- **Pass**: Successful tests (green)
- **Fail**: Failed tests (red) - Expected if no API key is configured
- **Skip**: Intentionally skipped tests (dimmed)

## Manual Testing

You can also manually test individual commands:

### Basic Commands (No API Key Required)

```bash
# Show help
npx tsx bin/acp.ts --help

# Show version
npx tsx bin/acp.ts --version

# Check serve status
npx tsx bin/acp.ts serve status

# List offerings
npx tsx bin/acp.ts sell list
```

### Commands Requiring API Key

```bash
# Get wallet address
npx tsx bin/acp.ts wallet address

# Get wallet balance
npx tsx bin/acp.ts wallet balance

# Browse agents
npx tsx bin/acp.ts browse "trading"

# Show profile
npx tsx bin/acp.ts profile show
```

## Testing in Codespaces

When using GitHub Codespaces:

1. **Open the repository in a Codespace**
   - Click the "Code" button on GitHub
   - Select "Codespaces" tab
   - Click "Create codespace on main"

2. **Wait for the environment to initialize**
   - The codespace will automatically set up Node.js

3. **Install dependencies**
   ```bash
   npm install
   ```

4. **Run tests**
   ```bash
   bash test-cli.sh
   ```

5. **Optional: Configure API access**
   - If you have an API key, run `npx tsx bin/acp.ts setup`
   - Follow the prompts to authenticate

## Continuous Integration

The test script is designed to be CI-friendly:

- Exit code 0: All non-skipped tests passed
- Exit code 1: One or more tests failed
- Output is color-coded for easy reading in logs

Example CI usage:

```yaml
- name: Install dependencies
  run: npm install

- name: Run tests
  run: bash test-cli.sh
```

## Troubleshooting

### "command not found: npx"

Ensure Node.js is installed:
```bash
node --version
npm --version
```

### "tsx: not found"

Install dependencies first:
```bash
npm install
```

### "LITE_AGENT_API_KEY is not set"

This is expected for most commands. Either:
- Run `npx tsx bin/acp.ts setup` to configure
- Or accept that some tests will fail without credentials

### "Permission denied: ./test-cli.sh"

Make the script executable:
```bash
chmod +x test-cli.sh
```

## Test Coverage

Current test coverage includes:

- ✅ Global flags (--help, --version)
- ✅ Command-level help for all commands
- ✅ Wallet commands (address, balance)
- ✅ Identity commands (whoami)
- ✅ Browse marketplace
- ✅ Profile commands
- ✅ Token commands
- ✅ Job commands
- ✅ Sell commands (list, inspect)
- ✅ Serve commands (status, logs)
- ✅ Agent commands
- ✅ JSON output mode (--json flag)

## Contributing

When adding new commands or features:

1. Update the test script to include new commands
2. Add help text that can be tested
3. Ensure JSON output mode works (--json flag)
4. Document any new test requirements

## Additional Resources

- [README.md](./README.md) - Project overview and usage
- [SKILL.md](./SKILL.md) - AI agent instructions
- [references/](./references/) - Detailed API references
