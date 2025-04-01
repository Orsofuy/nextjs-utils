#!/bin/bash

# Security precaution - exit on error and undefined variables
set -eu

# Load environment variables from .env file if it exists
if [ -f .env ]; then
  echo "📂 Loading environment variables from .env..."
  
  # Use dotenv CLI if available, otherwise fallback to export
  if command -v dotenv > /dev/null 2>&1; then
    dotenv > /dev/null
  else
    export $(grep -v '^#' .env | xargs)
  fi
fi

# Temporary file name with random component
TMP_FILE="i18n-script-$(date +%s).js"
SCRIPT_URL="https://raw.githubusercontent.com/Orsofuy/nextjs-utils/refs/heads/main/populateLocales.js"

echo "🔍 Downloading latest translation script..."
curl -sS "$SCRIPT_URL" -o "$TMP_FILE"

echo "🚀 Running translation process..."
node "$TMP_FILE" "$@"

echo "🧹 Cleaning up..."
rm -f "$TMP_FILE"

echo "✅ Done!"
