#!/usr/bin/env bash
# =============================================================================
# Quick Start Script for GitHub Codespaces
#
# This script helps you quickly set up and test the ACP CLI in a Codespace.
# It installs dependencies and optionally runs the test suite.
#
# Usage:
#   bash quick-start.sh              # Install and run tests
#   bash quick-start.sh --skip-tests # Install only, skip tests
# =============================================================================

set -e  # Exit on error

# Color helpers
green() { printf "\033[32m%s\033[0m\n" "$1"; }
blue()  { printf "\033[34m%s\033[0m\n" "$1"; }
yellow() { printf "\033[33m%s\033[0m\n" "$1"; }

echo ""
blue "═══════════════════════════════════════════════════════"
blue "  ACP CLI - Quick Start for GitHub Codespaces"
blue "═══════════════════════════════════════════════════════"
echo ""

# Check if npm is available
if ! command -v npm &> /dev/null; then
    echo "Error: npm is not installed. Please install Node.js first."
    exit 1
fi

# Show Node.js and npm versions
echo "Node.js version: $(node --version)"
echo "npm version: $(npm --version)"
echo ""

# Step 1: Install dependencies
blue "Step 1: Installing dependencies..."
npm install

if [ $? -eq 0 ]; then
    green "✓ Dependencies installed successfully"
else
    echo "Error: Failed to install dependencies"
    exit 1
fi
echo ""

# Step 2: Verify CLI
blue "Step 2: Verifying CLI installation..."
npx tsx bin/acp.ts --version > /dev/null 2>&1

if [ $? -eq 0 ]; then
    green "✓ CLI is working correctly"
else
    echo "Error: CLI verification failed"
    exit 1
fi
echo ""

# Step 3: Run tests (unless --skip-tests flag is provided)
if [ "$1" != "--skip-tests" ]; then
    blue "Step 3: Running test suite..."
    echo ""
    
    # Make test script executable if needed
    chmod +x test-cli.sh
    
    # Run tests (don't exit on failure, we'll handle it)
    set +e
    bash test-cli.sh
    TEST_EXIT_CODE=$?
    set -e
    
    echo ""
    if [ $TEST_EXIT_CODE -eq 0 ]; then
        green "✓ All tests completed successfully"
    else
        yellow "⚠ Some tests failed (this is expected without API configuration)"
    fi
else
    yellow "⊘ Skipping tests (--skip-tests flag provided)"
fi

echo ""
blue "═══════════════════════════════════════════════════════"
green "Setup Complete!"
blue "═══════════════════════════════════════════════════════"
echo ""

echo "Next steps:"
echo ""
echo "  1. Run the CLI:"
echo "     npx tsx bin/acp.ts --help"
echo ""
echo "  2. Configure API access (optional):"
echo "     npx tsx bin/acp.ts setup"
echo ""
echo "  3. Run tests:"
echo "     bash test-cli.sh"
echo ""
echo "  For more information, see:"
echo "  - README.md for usage instructions"
echo "  - TESTING.md for testing guide"
echo ""
