#!/bin/bash

# Exit script on any error
set -e

# Variables
PROJECT_DIR=$(pwd)
LOG_DIR="$PROJECT_DIR/cleanup_logs"
UNUSED_FILES_LOG="$LOG_DIR/unused_files.log"
UNUSED_DEPS_LOG="$LOG_DIR/unused_deps.log"

# Ensure required tools are installed
if ! command -v npx >/dev/null 2>&1; then
  echo "npx is not installed. Installing it now..."
  npm install -g npx
fi

if ! command -v yarn >/dev/null 2>&1; then
  echo "Yarn is not installed. Installing it now..."
  npm install -g yarn
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is not installed. Installing it now..."
  sudo apt-get install -y jq || sudo yum install -y jq || brew install jq
fi

# Create logs directory
mkdir -p "$LOG_DIR"

# Detect entry file and project structure
ENTRY_FILE=""
if [ -f "src/index.js" ]; then
  ENTRY_FILE="src/index.js"
elif [ -f "src/index.ts" ]; then
  ENTRY_FILE="src/index.ts"
elif [ -f "pages/index.js" ]; then
  ENTRY_FILE="pages/index.js"
elif [ -f "pages/index.ts" ]; then
  ENTRY_FILE="pages/index.ts"
else
  echo "Could not detect an entry file (e.g., src/index.js or pages/index.js). Please enter the entry file path:"
  read -r ENTRY_FILE
  if [ ! -f "$ENTRY_FILE" ]; then
    echo "Invalid file. Exiting."
    exit 1
  fi
fi

# Step 1: Find unused files using deadfile
echo "Scanning for unused files with entry file: $ENTRY_FILE..."
if npx deadfile "$ENTRY_FILE" -o "$UNUSED_FILES_LOG"; then
  if [ -f "$UNUSED_FILES_LOG" ] && [ -s "$UNUSED_FILES_LOG" ]; then
    echo "Unused files found. Log saved to: $UNUSED_FILES_LOG"
  else
    echo "No unused files found."
    [ -f "$UNUSED_FILES_LOG" ] && rm "$UNUSED_FILES_LOG"
  fi
else
  echo "Deadfile scan failed. Ensure your project structure is correct. You may need to debug manually or use alternative tools."
fi

# Step 2: Find unused dependencies using depcheck
echo "Scanning for unused dependencies..."
npx depcheck --json > "$UNUSED_DEPS_LOG"

if [ -f "$UNUSED_DEPS_LOG" ] && [ -s "$UNUSED_DEPS_LOG" ]; then
  echo "Unused dependencies found. Log saved to: $UNUSED_DEPS_LOG"
else
  echo "No unused dependencies found."
  [ -f "$UNUSED_DEPS_LOG" ] && rm "$UNUSED_DEPS_LOG"
fi

# Step 3: Cleanup unused files interactively
if [ -f "$UNUSED_FILES_LOG" ]; then
  echo "Do you want to delete the unused files listed in $UNUSED_FILES_LOG? (y/n)"
  read -r DELETE_FILES
  if [[ "$DELETE_FILES" =~ ^[Yy]$ ]]; then
    while IFS= read -r file; do
      if [ -f "$file" ]; then
        echo "Deleting: $file"
        rm "$file"
      else
        echo "File not found: $file"
      fi
    done < "$UNUSED_FILES_LOG"
  fi
fi

# Step 4: Cleanup unused dependencies interactively
if [ -f "$UNUSED_DEPS_LOG" ]; then
  UNUSED_PACKAGES=$(jq -r '.dependencies[]' "$UNUSED_DEPS_LOG")
  if [ -n "$UNUSED_PACKAGES" ]; then
    echo "Do you want to remove the following unused dependencies? (y/n)"
    echo "$UNUSED_PACKAGES"
    read -r DELETE_DEPS
    if [[ "$DELETE_DEPS" =~ ^[Yy]$ ]]; then
      echo "$UNUSED_PACKAGES" | xargs yarn remove
    fi
  fi
fi

# Final cleanup
echo "Cleanup completed. Logs are saved in: $LOG_DIR"
