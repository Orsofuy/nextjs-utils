#!/bin/bash
set -e

###############################################################################
# SINGLE SCRIPT TO MAKE YOUR NEXT.JS APP MULTILINGUAL
# WITH AUTOMATIC TRANSLATION OF COMMON.JSON KEYS
# -----------------------------------------------------------------------------
# 1) Prompts for default & additional locales (USER_DEFAULT_LOCALE, LOCALES_INPUT)
# 2) Installs necessary i18n dependencies
# 3) Configures i18n settings (next-i18next, next.config.js)
# 4) Creates the localization folder structure
# 5) Creates a LanguagePicker component
# 6) Embeds & runs a Node.js script (refactor-i18n.js) to refactor code
#    and insert i18n support using OpenAI
# 7) Implements an automatic step that reads the default locale's common.json
#    and asks OpenAI to create translations for all other locales
###############################################################################

###############################################################################
# GLOBAL DEFAULTS
###############################################################################
DEFAULT_LOCALE="es"
DEFAULT_ADDITIONAL_LOCALES="en,fr,de,zh,ar,pt,ru,ja"
OPENAI_MODEL="gpt-4o-mini"
MAX_CONCURRENT_REQUESTS=20
LOCALE_FOLDER="public/locales"

###############################################################################
# Function to find directories (pages, components)
###############################################################################
find_directory() {
  local dir_type="$1"
  local result=""

  case "$dir_type" in
    "pages")
      result=$(
        find . -type f \( -name "_app.js" -o -name "layout.js" -o -name "layout.tsx" -o -name "page.js" -o -name "page.tsx" \) \
          ! -path "./node_modules/*" \
          ! -path "./.next/*" \
          -print -quit \
        | xargs dirname
      )

      # If the path is, for example, "./app/audio-transcription",
      # strip everything after "/app" so you end up with "./app"
      result="$(echo "$result" | sed -E 's|(.*\/app).*|\1|')"
      ;;

    "components")
      result=$(find . -type d -name "components" \
                 ! -path "./node_modules/*" \
                 ! -path "./.next/*" \
                 | head -n 1)
      ;;

    *)
      echo "Internal error: unknown dir_type $dir_type"
      exit 1
      ;;
  esac

  # Fallback if nothing was found or if the sed fails to match
  if [ -z "$result" ]; then
    echo "Could not find '$dir_type' directory automatically. Provide a path (e.g., './app' or './components'):"
    read -r result
    if [ ! -d "$result" ]; then
      echo "Error: '$result' is not a directory."
      exit 1
    fi
  fi

  echo "$result"
}

###############################################################################
# Step 1: Prompt for locales
###############################################################################
# Help function
display_help() {
  echo "Usage: $0 [options]"
  echo
  echo "Options:"
  echo "  -y                 Run unattended with default values"
  echo "  -h                 Show this help menu"
  echo "  -m MODEL           Specify the OpenAI model (default: $OPENAI_MODEL)"
  echo "  -c MAX_REQUESTS    Set the maximum concurrent OpenAI requests (default: $MAX_CONCURRENT_REQUESTS)"
  echo "  -l DEFAULT_LOCALE  Set the default locale (default: $DEFAULT_LOCALE)"
  echo "  -a ADD_LOCALES     Set additional locales as a comma-separated list (default: $DEFAULT_ADDITIONAL_LOCALES)"
  echo "  -f LOCALE_FOLDER   Set the locale folder path (default: $LOCALE_FOLDER)"
  echo
  echo "This script configures a Next.js project for i18n support, generates locale files, and automatically translates strings using OpenAI."
  exit 0
}

# Default values
UNATTENDED=false

# Parse flags
while getopts "yhm:c:l:a:f:" opt; do
  case $opt in
    y)
      UNATTENDED=true
      ;;
    h)
      display_help
      ;;
    m)
      OPENAI_MODEL="$OPTARG"
      ;;
    c)
      MAX_CONCURRENT_REQUESTS="$OPTARG"
      ;;
    l)
      DEFAULT_LOCALE="$OPTARG"
      ;;
    a)
      DEFAULT_ADDITIONAL_LOCALES="$OPTARG"
      ;;
    f)
      LOCALE_FOLDER="$OPTARG"
      ;;
    *)
      display_help
      ;;
  esac
done

# Set default locale
if [ "$UNATTENDED" = true ]; then
  echo "Running unattended with default locale: $DEFAULT_LOCALE"
else
  echo "Enter your default locale (e.g., 'es') [Default: $DEFAULT_LOCALE]:"
  read -r USER_DEFAULT_LOCALE
  if [ -n "$USER_DEFAULT_LOCALE" ]; then
    DEFAULT_LOCALE="$USER_DEFAULT_LOCALE"
  fi
fi

echo "Default locale set to: $DEFAULT_LOCALE"

# Set additional locales
if [ "$UNATTENDED" = true ]; then
  LOCALES_INPUT="$DEFAULT_ADDITIONAL_LOCALES"
else
  echo "Default additional locales: $DEFAULT_ADDITIONAL_LOCALES"
  echo "Press ENTER to keep or specify comma-separated locales (e.g., 'en,fr,de'):"
  read -r LOCALES_INPUT
  if [ -z "$LOCALES_INPUT" ]; then
    LOCALES_INPUT="$DEFAULT_ADDITIONAL_LOCALES"
  fi
fi

# Split into array
IFS=',' read -ra LOCALES <<< "$LOCALES_INPUT"
for i in "${!LOCALES[@]}"; do
  # Trim whitespace
  LOCALES[$i]=$(echo "${LOCALES[$i]}" | xargs)
done

echo "Additional locales: ${LOCALES[*]}"

# Combine all locales
ALL_LOCALES=("$DEFAULT_LOCALE" "${LOCALES[@]}")
LOCALES_JS_ARRAY="[ $(printf "\"%s\"," "${ALL_LOCALES[@]}" | sed 's/,$//') ]"

echo "Locales JavaScript Array: $LOCALES_JS_ARRAY"

###############################################################################
# Step 2: Install i18n dependencies
###############################################################################
echo "📦 Installing next-i18next & i18n dependencies..."
yarn add next-i18next i18next react-i18next i18next-http-backend i18next-browser-languagedetector --dev

###############################################################################
# Step 3: Create/Update next-i18next.config.js
###############################################################################
echo "🛠 Creating 'next-i18next.config.js'..."
cat <<EOT > next-i18next.config.js
module.exports = {
  i18n: {
    defaultLocale: "${DEFAULT_LOCALE}",
    locales: ${LOCALES_JS_ARRAY}
  },
};
EOT

###############################################################################
# Step 4: Update next.config.js to reference i18n
###############################################################################
if [ ! -f next.config.js ]; then
  echo "module.exports = {};" > next.config.js
fi
if ! grep -q "next-i18next.config" next.config.js; then
  # Insert the import statement at the top
  sed -i "1i const { i18n } = require('./next-i18next.config');\n" next.config.js
  # Add i18n to the exported config
  sed -i "/module.exports = {/a \  i18n," next.config.js
fi

###############################################################################
# Step 5: Create public/locales structure
###############################################################################
echo "📁 Creating localization folder structure..."
mkdir -p "${LOCALE_FOLDER}"
for L in "${ALL_LOCALES[@]}"; do
  mkdir -p "${LOCALE_FOLDER}/${L}"
  if [ ! -f "${LOCALE_FOLDER}/${L}/common.json" ]; then
    echo "{}" > "${LOCALE_FOLDER}/${L}/common.json"
    echo "Created '${LOCALE_FOLDER}/${L}/common.json'"
  fi
done

###############################################################################
# Detect pages & components directories
###############################################################################
pages_dir=$(find_directory "pages")
components_dir=$(find_directory "components")
echo "Pages directory: $pages_dir"
echo "Components directory: $components_dir"

###############################################################################
# Step 6: Create LanguagePicker component
###############################################################################
echo "🛠 Creating LanguagePicker component..."
if [ ! -d "$components_dir" ]; then
  mkdir -p "$components_dir"
  echo "Created 'components' directory."
fi

cat <<EOT > "${components_dir}/LanguagePicker.js"
import { useRouter } from 'next/router';
import { useTranslation } from 'react-i18next';

export default function LanguagePicker() {
  const router = useRouter();
  const { t } = useTranslation('common');

  const availableLocales = ${LOCALES_JS_ARRAY};

  const handleLanguageChange = (locale) => {
    router.push(router.asPath, router.asPath, { locale });
  };

  return (
    <div style={{ margin: '1rem 0' }}>
      <h3>{t("Select Language")}:</h3>
      {availableLocales.map((lng) => (
        <button key={lng} onClick={() => handleLanguageChange(lng)}>
          {lng.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
EOT
echo "✅ Created LanguagePicker.js in '$components_dir'"

###############################################################################
# Step 7: Embed the Node.js script for OpenAI refactor
#    Also adds code for keys translation across locales
###############################################################################
echo "📝 Creating Node.js script for OpenAI interactions..."

cat <<'NODEJS_SCRIPT' > refactor-i18n.js
/*****************************************************************************
 * refactor-i18n.js
 *
 * 1. Gathers & updates Next.js files for i18n using OpenAI.
 * 2. Extracts new i18n keys from the GPT-updated code, merges them into each 
 *    locale's common.json.
 * 3. (Optionally) translates the default locale's common.json to all other
 *    locales via OpenAI.
 *****************************************************************************/
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

// Read environment variables
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const MAX_CONCURRENT_REQUESTS = parseInt(process.env.MAX_CONCURRENT_REQUESTS || "20", 10);
const DEFAULT_LOCALE = process.env.DEFAULT_LOCALE || "es";
const ADDITIONAL_LOCALES_JSON = process.env.ADDITIONAL_LOCALES_JSON || '["en","fr","de","zh","ar","pt","ru","ja"]';
const ADDITIONAL_LOCALES = JSON.parse(ADDITIONAL_LOCALES_JSON);
const LOCALE_FOLDER = "public/locales";

// For ignoring or including files
const IGNORED_DIRS = ["node_modules", ".next", ".git", "dist", "build"];
const VALID_EXTENSIONS = [".js", ".jsx", ".ts", ".tsx"];

// Simple logging toggle
const verbose = process.argv.includes("-v");
const log = (msg) => { if (verbose) console.log(msg); };

// Ensure we have an API key
if (!OPENAI_API_KEY) {
  console.error("❌ Error: OPENAI_API_KEY is not set.");
  process.exit(1);
}

/**
 * sanitizeCode()
 * Remove unwanted formatting and ensure a newline at the end
 */
function sanitizeCode(output) {
  let sanitizedOutput = output.replace(/^\s*```[a-zA-Z]*\s*|\s*```$/g, '');
  if (!sanitizedOutput.endsWith('\n')) {
    sanitizedOutput += '\n';
  }
  return sanitizedOutput;
}

/**
 * validateUpdatedCode()
 * Basic checks on GPT-updated code
 */
function validateUpdatedCode(newCode, originalCode) {
  if (!newCode || newCode.trim().length === 0) {
    console.error("Validation failed: Updated code is empty.");
    return false;
  }

  return true;
}

/**
 * extractUsedKeys()
 * Returns a Set of translation keys found in the code with t("key")
 */
function extractUsedKeys(codeString) {
  const pattern = /t\((["'])([^"']+)\1\)/g;
  const usedKeys = new Set();
  let match;
  while ((match = pattern.exec(codeString)) !== null) {
    usedKeys.add(match[2]);
  }
  return usedKeys;
}

/**
 * updateCommonJson()
 * Merges new keys into each locale's common.json
 */
function updateCommonJson(keys) {
  const locales = [DEFAULT_LOCALE, ...ADDITIONAL_LOCALES];
  locales.forEach((locale) => {
    const commonFilePath = path.join(LOCALE_FOLDER, locale, "common.json");
    const currentTranslations = fs.existsSync(commonFilePath)
      ? JSON.parse(fs.readFileSync(commonFilePath, "utf8"))
      : {};
    const updatedTranslations = { ...currentTranslations, ...keys };
    fs.writeFileSync(commonFilePath, JSON.stringify(updatedTranslations, null, 2), "utf8");
    console.log(`✅ Updated: ${commonFilePath}`);
  });
}

/**
 * getEligibleFiles()
 * Recursively find files that:
 *  - are not in ignored directories
 *  - have a valid extension
 *  - do not already use i18n (quick check)
 *  - appear to be front-end code (has some JSX or HTML)
 */
function getEligibleFiles(dir) {
  let results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.includes(entry.name)) {
        results.push(...getEligibleFiles(fullPath));
      }
    } else {
      const ext = path.extname(fullPath);
      if (VALID_EXTENSIONS.includes(ext)) {
        const content = fs.readFileSync(fullPath, "utf8");
        // quick check: if there's already useTranslation or t( in it, skip
        // and only proceed if there's HTML/JSX-ish syntax
        if (!/useTranslation|t\(/.test(content) && /<[a-zA-Z]|jsx>/.test(content)) {
          results.push(fullPath);
        }
      }
    }
  }
  return results;
}

/**
 * processFileWithOpenAI()
 * Sends code to the OpenAI ChatCompletion API for refactoring,
 * returns JSON with shape:
 *   {
 *     needsUpdate: boolean,
 *     updatedCode: string,
 *     translations: { [key: string]: string }
 *   }
 */
async function processFileWithOpenAI(filePath, retryCount = 0) {
  const fileContent = fs.readFileSync(filePath, 'utf8');

  // Prompt ensures GPT only returns JSON with needed fields, 
  // and includes "needsUpdate" = true/false
  let prompt = `You are a Next.js and i18n expert.
Refactor the following code to add multilingual support using react-i18next:
1. Identify all user-facing strings and replace them with meaningful translation keys.
2. Return ONLY valid JSON with the structure:
   {
     "needsUpdate": true/false,
     "updatedCode": "<full updated code if needed, otherwise empty>",
     "translations": {
       "<translationKey>": "<original string>"
     }
   }
3. If no user-facing strings are detected, set "needsUpdate" to false and leave "updatedCode" empty.
4. "updatedCode" must contain the full file content with updated references to translation keys, if changes are made.
5. "translations" must include all original user-facing strings keyed by their new i18n keys.
6. Do not delete existing comments unless strictly necessary for functionality or to fix errors.
7. Ensure the updated code compiles, retains its original functionality, and is properly formatted.
8. Do not include any additional comments, explanations, or formatting like code blocks (\`\`\`).
9. Avoid adding unnecessary whitespace at the end of lines or when adding new lines.

Here is the code:
${fileContent}`;

  if (retryCount > 0) {
    prompt = `The previous update attempt failed. Please ensure the following corrections:
1. Return valid JSON with the structure:
   {
     "needsUpdate": true/false,
     "updatedCode": "<full updated code if needed, otherwise empty>",
     "translations": {
       "<translationKey>": "<original string>"
     }
   }
2. If no user-facing strings are detected, set "needsUpdate" to false and leave "updatedCode" empty.
3. Ensure "updatedCode" compiles and i18n is properly added.
4. "translations" must only contain relevant keys and their original strings.
5. Do not include code fences, extra comments, or explanations.
6. Ensure the code compiles, retains its original functionality, and is properly formatted.
7. Avoid adding unnecessary whitespace at the end of lines or when adding new lines.

Here is the code that needs correction:
${fileContent}`;
  }


  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 3000,
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API Error: ${response.status} - ${error}`);
  }

  const result = await response.json();
  const gptMessage = result?.choices?.[0]?.message?.content;
  if (!gptMessage) {
    throw new Error("Invalid response from OpenAI: No content returned.");
  }

  let parsed;
  try {
    parsed = JSON.parse(gptMessage.trim());
  } catch (err) {
    if (retryCount < 2) {
      console.warn(`Retrying ${filePath} due to JSON parse error...`);
      return processFileWithOpenAI(filePath, retryCount + 1);
    }
    throw new Error(`Failed to parse JSON: ${err.message}`);
  }

  if (parsed.needsUpdate) {
    parsed.updatedCode = sanitizeCode(parsed.updatedCode);
    if (!validateUpdatedCode(parsed.updatedCode, fileContent)) {
      if (retryCount < 2) {
        console.warn(`Retrying ${filePath} due to validation issues...`);
        return processFileWithOpenAI(filePath, retryCount + 1);
      }
      throw new Error("Validation failed for updated code after retries.");
    }
  }

  return parsed;
}

/**
 * processFiles()
 * - Processes each file with OpenAI, then merges final used keys 
 *   into each locale's common.json
 */
async function processFiles(files) {
  const allKeys = {};

  // batch for concurrency
  const batches = [];
  for (let i = 0; i < files.length; i += MAX_CONCURRENT_REQUESTS) {
    batches.push(files.slice(i, i + MAX_CONCURRENT_REQUESTS));
  }

  for (const batch of batches) {
    await Promise.all(
      batch.map(async (filePath) => {
        try {
          log(`🔧 Processing: ${filePath}`);
          const { needsUpdate, updatedCode, translations } = await processFileWithOpenAI(filePath);
          
          if (!needsUpdate) {
            console.log(`⏩ No update needed for ${filePath}`);
            return;
          }

          // Write updated code to disk
          fs.writeFileSync(filePath, updatedCode, 'utf8');
          console.log(`✅ Updated file: ${filePath}`);

          // 1) Parse the updated code for actually used keys
          const usedKeys = extractUsedKeys(updatedCode);

          // 2) Filter out any keys that aren't used in the code
          const finalKeys = {};
          for (const [k, v] of Object.entries(translations || {})) {
            if (usedKeys.has(k)) {
              finalKeys[k] = v;
            }
          }

          // 3) Merge finalKeys into the global allKeys
          for (const [k, v] of Object.entries(finalKeys)) {
            allKeys[k] = v;
          }
        } catch (error) {
          console.error(`❌ Error processing ${filePath}:`, error.message);
        }
      })
    );
  }

  // If we have any new keys, update each locale's common.json
  if (Object.keys(allKeys).length > 0) {
    updateCommonJson(allKeys);
  }
}

/******************************************************************************
 * autoTranslateCommonJson()
 * - Reads the default locale's common.json
 * - Translates each key's value for all additional locales
 * - Merges those translations into each locale's common.json
 ******************************************************************************/
async function autoTranslateCommonJson() {
  const defaultCommonFilePath = path.join(LOCALE_FOLDER, DEFAULT_LOCALE, 'common.json');
  if (!fs.existsSync(defaultCommonFilePath)) {
    console.log(`No default common.json found at: ${defaultCommonFilePath}`);
    return;
  }

  const defaultData = JSON.parse(fs.readFileSync(defaultCommonFilePath, 'utf8'));
  if (!defaultData || Object.keys(defaultData).length === 0) {
    console.log(`Default locale (${DEFAULT_LOCALE}) common.json is empty or invalid.`);
    return;
  }

  const translationsPerLocale = {};

  for (const locale of ADDITIONAL_LOCALES) {
    if (locale === DEFAULT_LOCALE) continue; // skip if same
    console.log(`Translating from ${DEFAULT_LOCALE} to ${locale}...`);
    translationsPerLocale[locale] = {};

    for (const [key, value] of Object.entries(defaultData)) {
      if (!value || typeof value !== "string") {
        translationsPerLocale[locale][key] = value;
        continue;
      }
      try {
        // call openai to translate
        const translatedText = await openaiTranslateText(value, DEFAULT_LOCALE, locale);
        translationsPerLocale[locale][key] = translatedText;
      } catch (err) {
        console.error(`Error translating key "${key}":`, err.message);
        translationsPerLocale[locale][key] = value; // fallback
      }
    }
  }

  // Write out the new translations
  for (const locale of ADDITIONAL_LOCALES) {
    if (locale === DEFAULT_LOCALE) continue;
    const localeFilePath = path.join(LOCALE_FOLDER, locale, 'common.json');
    const existingData = fs.existsSync(localeFilePath)
      ? JSON.parse(fs.readFileSync(localeFilePath, 'utf8'))
      : {};
    const merged = { ...existingData, ...translationsPerLocale[locale] };
    fs.writeFileSync(localeFilePath, JSON.stringify(merged, null, 2), 'utf8');
    console.log(`✅ Wrote translations to ${localeFilePath}`);
  }
}

/**
 * openaiTranslateText()
 * - Invokes the ChatCompletion endpoint to translate a single string
 */
async function openaiTranslateText(text, fromLang, toLang) {
  const prompt = `Please translate the following text from ${fromLang} to ${toLang}:
Text: "${text}".
Return only the translation, without quotes or extra commentary.`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1000,
      temperature: 0,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API Error: ${response.status} - ${error}`);
  }

  const result = await response.json();
  const translation = result?.choices?.[0]?.message?.content?.trim();
  return translation || text;
}

// MAIN ENTRY
(async () => {
  console.log("🔍 Gathering files for i18n processing...");
  const allFiles = getEligibleFiles(process.cwd());
  if (!allFiles.length) {
    console.log("✅ No eligible files found for i18n refactoring. Skipping...");
  } else {
    console.log(`🚀 Sending ${allFiles.length} file(s) to OpenAI in parallel...`);
    await processFiles(allFiles);
    console.log("🎉 Finished i18n refactoring!");
  }

  // Finally, auto-translate from default locale to all additional locales
  console.log("🔤 Auto-translating from default locale to others...");
  await autoTranslateCommonJson();
  console.log("🎉 Done with auto-translation step!");
})();
NODEJS_SCRIPT

echo "✅ Created 'refactor-i18n.js'."

###############################################################################
# Step 8: Export environment variables so Node script can read them
###############################################################################
export OPENAI_MODEL="$OPENAI_MODEL"
export MAX_CONCURRENT_REQUESTS="$MAX_CONCURRENT_REQUESTS"
export DEFAULT_LOCALE="$DEFAULT_LOCALE"
# Convert the LOCALES array into a JSON array string, e.g. ["en","fr"]
ADDITIONAL_LOCALES_JSON=$(node -e "console.log(JSON.stringify(process.argv.slice(1)))" "${LOCALES[@]}")
export ADDITIONAL_LOCALES_JSON

###############################################################################
# Step 9: Run the Node.js script for OpenAI interactions
###############################################################################
echo "🚀 Running Node.js script to update files with OpenAI and auto-translate..."
node refactor-i18n.js

###############################################################################
# Cleanup (if you want to remove the Node.js script):
###############################################################################
rm refactor-i18n.js
echo "🧹 Cleaned up temporary scripts."

###############################################################################
# Step 10: Done - final instructions
###############################################################################
echo "🎉 Multilingual setup & refactoring complete!"
echo "Default locale: $DEFAULT_LOCALE"
echo "Additional locales: ${LOCALES[*]}"
echo "LanguagePicker created at: $components_dir/LanguagePicker.js"
echo "All eligible files have been updated with i18n keys, and the default locale's"
echo "'common.json' has been auto-translated to the other locales!"
echo "Try running 'yarn dev' or 'yarn build' to confirm everything is working."
