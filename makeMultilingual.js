#!/usr/bin/env node

/**
 * setup-i18n.js
 *
 * A single Node.js script that sets up i18n in a Next.js app and optionally
 * uses OpenAI to refactor user-facing strings and translate them into multiple locales.
 *
 * Usage:
 *   node setup-i18n.js [options]
 *
 * Options:
 *   -y, --yes          Run unattended (accept all defaults)
 *   -h, --help         Show help
 *   -m, --model        Specify OpenAI model (default: gpt-4o-mini)
 *   -c, --concurrency  Max concurrent OpenAI requests (default: 20)
 *   -l, --locale       Default locale (default: es)
 *   -a, --locales      Comma-separated additional locales (default: en,fr,de,zh,ar,pt,ru,ja)
 *   -f, --folder       Locale folder path (default: public/locales)
 *   -p, --package-manager  Which package manager to use: yarn|npm|pnpm (default: yarn)
 *
 * Example:
 *   node setup-i18n.js -y -m gpt-4 -c 10 -l en -a "fr,de,it" -f "public/locales" -p npm
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// We'll do a dynamic import for fetch in Node < 18
let fetch;

// -------------------------------------------------------------------------------------
// Default Config
// -------------------------------------------------------------------------------------
const DEFAULTS = {
  OPENAI_MODEL: 'gpt-4o-mini',
  MAX_CONCURRENT_REQUESTS: 20,
  DEFAULT_LOCALE: 'es',
  DEFAULT_ADDITIONAL_LOCALES: 'en,fr,de,zh,ar,pt,ru,ja',
  LOCALE_FOLDER: 'public/locales',
  PACKAGE_MANAGER: 'yarn', // default PM
};

// -------------------------------------------------------------------------------------
// Parse Command-Line Arguments
// -------------------------------------------------------------------------------------
let UNATTENDED = false;
let OPENAI_MODEL = DEFAULTS.OPENAI_MODEL;
let MAX_CONCURRENT_REQUESTS = DEFAULTS.MAX_CONCURRENT_REQUESTS;
let DEFAULT_LOCALE = DEFAULTS.DEFAULT_LOCALE;
let ADDITIONAL_LOCALES = DEFAULTS.DEFAULT_ADDITIONAL_LOCALES; // string, comma-separated
let LOCALE_FOLDER = DEFAULTS.LOCALE_FOLDER;
let PACKAGE_MANAGER = DEFAULTS.PACKAGE_MANAGER;

function printHelp() {
  console.log(`
Usage: ${path.basename(process.argv[1])} [options]

Options:
  -y, --yes            Run unattended (accept all defaults)
  -h, --help           Show this help
  -m, --model          Specify OpenAI model (default: ${DEFAULTS.OPENAI_MODEL})
  -c, --concurrency    Set max concurrent OpenAI requests (default: ${DEFAULTS.MAX_CONCURRENT_REQUESTS})
  -l, --locale         Default locale (default: ${DEFAULTS.DEFAULT_LOCALE})
  -a, --locales        Comma-separated additional locales (default: ${DEFAULTS.DEFAULT_ADDITIONAL_LOCALES})
  -f, --folder         Locale folder path (default: ${DEFAULTS.LOCALE_FOLDER})
  -p, --package-manager  Which package manager to use (yarn|npm|pnpm) (default: ${DEFAULTS.PACKAGE_MANAGER})

Environment variables:
  OPENAI_API_KEY   Your OpenAI API key must be set in the environment

Example:
  node ${path.basename(process.argv[1])} -y -m gpt-4 -c 10 -l en -a "fr,de,it" -f "public/locales" -p npm
`);
}

function parseArgs() {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '-y':
      case '--yes':
        UNATTENDED = true;
        break;
      case '-h':
      case '--help':
        printHelp();
        process.exit(0);
      case '-m':
      case '--model':
        OPENAI_MODEL = args[i + 1];
        i++;
        break;
      case '-c':
      case '--concurrency':
        MAX_CONCURRENT_REQUESTS = parseInt(args[i + 1], 10);
        i++;
        break;
      case '-l':
      case '--locale':
        DEFAULT_LOCALE = args[i + 1];
        i++;
        break;
      case '-a':
      case '--locales':
        ADDITIONAL_LOCALES = args[i + 1];
        i++;
        break;
      case '-f':
      case '--folder':
        LOCALE_FOLDER = args[i + 1];
        i++;
        break;
      case '-p':
      case '--package-manager':
        PACKAGE_MANAGER = args[i + 1];
        i++;
        break;
      default:
        console.error(`Unknown argument: ${arg}`);
        printHelp();
        process.exit(1);
    }
  }
}
parseArgs();

// -------------------------------------------------------------------------------------
// Basic prompt function if not in unattended mode
// -------------------------------------------------------------------------------------
async function prompt(question, defaultValue) {
  if (UNATTENDED) {
    return defaultValue;
  }

  return new Promise((resolve) => {
    process.stdout.write(`${question} [Default: ${defaultValue}]: `);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.once('data', (data) => {
      process.stdin.pause();
      const answer = data.trim();
      resolve(answer || defaultValue);
    });
  });
}

// -------------------------------------------------------------------------------------
// Step 1: Prompt for locales
// -------------------------------------------------------------------------------------
async function stepPromptForLocales() {
  DEFAULT_LOCALE = await prompt(
    "Enter your default locale (e.g. 'es')",
    DEFAULT_LOCALE
  );
  console.log(`Default locale set to: ${DEFAULT_LOCALE}`);

  const additional = await prompt(
    `Specify additional locales as comma-separated (e.g., 'en,fr,de')`,
    ADDITIONAL_LOCALES
  );
  ADDITIONAL_LOCALES = additional;
  console.log(`Additional locales set to: ${ADDITIONAL_LOCALES}`);
}

// -------------------------------------------------------------------------------------
// Convert the additional locales to array
// -------------------------------------------------------------------------------------
function getAllLocales() {
  const splitted = ADDITIONAL_LOCALES.split(',');
  const trimmed = splitted.map((loc) => loc.trim()).filter(Boolean);
  // Combine default + additional
  return [DEFAULT_LOCALE, ...trimmed];
}

// -------------------------------------------------------------------------------------
// Step 2: Install dependencies (supports yarn, npm, pnpm, etc.)
// -------------------------------------------------------------------------------------
function stepInstallDependencies() {
  console.log("📦 Installing next-i18next & i18n dependencies...");

  // Build the install command based on the selected package manager
  const dependencies = [
    'next-i18next',
    'i18next',
    'react-i18next',
    'i18next-http-backend',
    'i18next-browser-languagedetector',
  ];

  let installCommand = '';
  switch (PACKAGE_MANAGER) {
    case 'npm':
      installCommand = `npm install --save-dev ${dependencies.join(' ')}`;
      break;
    case 'pnpm':
      installCommand = `pnpm add -D ${dependencies.join(' ')}`;
      break;
    case 'yarn':
    default:
      installCommand = `yarn add --dev ${dependencies.join(' ')}`;
      break;
  }

  execSync(installCommand, { stdio: 'inherit' });
}

// -------------------------------------------------------------------------------------
// Step 3: Create/Update next-i18next.config.js
// -------------------------------------------------------------------------------------
function stepCreateNextI18NextConfig(localesArray) {
  console.log("🛠 Creating 'next-i18next.config.js'...");

  const content = `
module.exports = {
  i18n: {
    defaultLocale: "${DEFAULT_LOCALE}",
    locales: [${localesArray.map((l) => `"${l}"`).join(', ')}],
  },
};
`.trimStart();

  fs.writeFileSync('next-i18next.config.js', content, 'utf8');
  console.log("✅ next-i18next.config.js created/updated.");
}

// -------------------------------------------------------------------------------------
// Step 4: Update next.config.js to reference i18n
// -------------------------------------------------------------------------------------
function stepUpdateNextConfig() {
  if (!fs.existsSync('next.config.js')) {
    fs.writeFileSync('next.config.js', 'module.exports = {};', 'utf8');
  }

  const fileData = fs.readFileSync('next.config.js', 'utf8');
  if (!fileData.includes("next-i18next.config")) {
    // Insert the import statement at the top
    let updatedData = `const { i18n } = require('./next-i18next.config');\n` + fileData;

    // Add i18n to the exported config if not present
    if (!updatedData.match(/module\.exports\s*=\s*{[^}]*i18n[^}]*}/s)) {
      updatedData = updatedData.replace(
        /module\.exports\s*=\s*{([\s\S]*?)};/,
        `module.exports = {
  $1,
  i18n
};`
      );
    }

    fs.writeFileSync('next.config.js', updatedData, 'utf8');
    console.log("✅ next.config.js updated to reference i18n config.");
  } else {
    console.log("ℹ️ next.config.js already references i18n. Skipping update.");
  }
}

// -------------------------------------------------------------------------------------
// Step 5: Create public/locales structure
// -------------------------------------------------------------------------------------
function stepCreateLocalesFolder(allLocales) {
  console.log("📁 Creating localization folder structure...");
  if (!fs.existsSync(LOCALE_FOLDER)) {
    fs.mkdirSync(LOCALE_FOLDER, { recursive: true });
  }

  allLocales.forEach((locale) => {
    const localeDir = path.join(LOCALE_FOLDER, locale);
    if (!fs.existsSync(localeDir)) {
      fs.mkdirSync(localeDir, { recursive: true });
    }
    const commonJson = path.join(localeDir, 'common.json');
    if (!fs.existsSync(commonJson)) {
      fs.writeFileSync(commonJson, '{}', 'utf8');
      console.log(`Created '${commonJson}'`);
    }
  });
}

// -------------------------------------------------------------------------------------
// Helper: find pages or components directory
// -------------------------------------------------------------------------------------
function findDirectory(dirType) {
  // We'll mimic your Bash logic:
  // - search for _app.js, page.js, layout.js, etc. for "pages"
  // - search for "components" folder for "components"
  // - fallback to user prompt
  const searchPatternsPages = [
    '_app.js',
    'layout.js',
    'layout.tsx',
    'page.js',
    'page.tsx',
  ];

  const ignored = ['node_modules', '.next'];
  let foundDir = '';

  function recursiveSearch(startDir) {
    const entries = fs.readdirSync(startDir, { withFileTypes: true });
    for (const entry of entries) {
      if (ignored.includes(entry.name)) {
        continue;
      }
      const fullPath = path.join(startDir, entry.name);
      if (entry.isDirectory()) {
        const possible = recursiveSearch(fullPath);
        if (possible) return possible;
      } else {
        if (dirType === 'pages') {
          if (searchPatternsPages.includes(entry.name)) {
            return path.dirname(fullPath);
          }
        } else if (dirType === 'components') {
          if (entry.name === 'components') {
            // If we do find a literal folder named "components", we'd see it as a directory, not a file
            // so maybe just check if the name is "components" in the loop over directories.
          }
        }
      }
    }
    return '';
  }

  if (dirType === 'pages') {
    foundDir = recursiveSearch(process.cwd());
    if (foundDir) {
      // If we got something like "./app/audio-transcription", strip everything after "/app"
      const match = foundDir.match(/(.*\/app)/);
      if (match) {
        foundDir = match[1];
      }
    }
  } else if (dirType === 'components') {
    // simpler approach: look for a folder named "components" in the tree
    function findComponentsDir(startDir) {
      const entries = fs.readdirSync(startDir, { withFileTypes: true });
      for (const entry of entries) {
        if (ignored.includes(entry.name)) {
          continue;
        }
        const fullPath = path.join(startDir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'components') {
            return fullPath;
          }
          const possible = findComponentsDir(fullPath);
          if (possible) return possible;
        }
      }
      return '';
    }
    foundDir = findComponentsDir(process.cwd());
  }

  return foundDir;
}

// -------------------------------------------------------------------------------------
// Step 6: Create a LanguagePicker component
// -------------------------------------------------------------------------------------
function stepCreateLanguagePicker(componentsDir, allLocales) {
  console.log("🛠 Creating LanguagePicker component...");

  if (componentsDir && !fs.existsSync(componentsDir)) {
    fs.mkdirSync(componentsDir, { recursive: true });
    console.log(`Created '${componentsDir}' directory.`);
  }

  const jsArray = `[${allLocales.map((l) => `"${l}"`).join(', ')}]`;

  const pickerPath = path.join(componentsDir, 'LanguagePicker.js');
  const content = `
import { useRouter } from 'next/router';
import { useTranslation } from 'react-i18next';

export default function LanguagePicker() {
  const router = useRouter();
  const { t } = useTranslation('common');

  const availableLocales = ${jsArray};

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
`.trimStart();

  fs.writeFileSync(pickerPath, content, 'utf8');
  console.log(`✅ Created LanguagePicker.js in '${componentsDir}'`);
}

// -------------------------------------------------------------------------------------
// The giant refactor logic from your Bash + refactor-i18n.js, all in one place
// -------------------------------------------------------------------------------------
async function runRefactorAndTranslations(allLocales) {
  // We'll embed the entire logic that was in refactor-i18n.js
  // inside a function here.

  // We need to load fetch dynamically in Node < 18
  if (!fetch) {
    const { default: f } = await import('node-fetch');
    fetch = f;
  }

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) {
    console.error("❌ Error: OPENAI_API_KEY is not set in the environment.");
    return;
  }

  // Convert additional locales to an array excluding default
  const additionalLocales = allLocales.filter((loc) => loc !== DEFAULT_LOCALE);

  // The main concurrency-limited file processing function
  async function processFiles(files) {
    // We'll gather new translation keys from all processed files
    const allNewKeys = {};

    // batch for concurrency
    const batches = [];
    for (let i = 0; i < files.length; i += MAX_CONCURRENT_REQUESTS) {
      batches.push(files.slice(i, i + MAX_CONCURRENT_REQUESTS));
    }

    for (const batch of batches) {
      await Promise.all(
        batch.map(async (filePath) => {
          try {
            const result = await processFileWithOpenAI(filePath);
            if (result.needsUpdate) {
              fs.writeFileSync(filePath, result.updatedCode, 'utf8');
              console.log(`✅ Updated file: ${filePath}`);

              // Filter out only the keys that are actually used
              const usedKeys = extractUsedKeys(result.updatedCode);
              for (const [k, originalText] of Object.entries(result.translations)) {
                if (usedKeys.has(k)) {
                  allNewKeys[k] = originalText;
                }
              }
            } else {
              console.log(`⏩ No update needed for ${filePath}`);
            }
          } catch (err) {
            console.error(`❌ Error processing ${filePath}: ${err.message}`);
          }
        })
      );
    }

    // Merge new keys into each locale's common.json
    if (Object.keys(allNewKeys).length > 0) {
      updateCommonJson(allNewKeys, allLocales);
    }
  }

  function updateCommonJson(newKeys, locales) {
    locales.forEach((locale) => {
      const commonFilePath = path.join(LOCALE_FOLDER, locale, 'common.json');
      let currentTranslations = {};
      if (fs.existsSync(commonFilePath)) {
        currentTranslations = JSON.parse(fs.readFileSync(commonFilePath, 'utf8'));
      }
      const updated = { ...currentTranslations, ...newKeys };
      fs.writeFileSync(commonFilePath, JSON.stringify(updated, null, 2), 'utf8');
      console.log(`✅ Updated: ${commonFilePath}`);
    });
  }

  // Extract keys from updated code
  function extractUsedKeys(code) {
    const pattern = /t\((["'])([^"']+)\1\)/g;
    const usedKeys = new Set();
    let match;
    while ((match = pattern.exec(code)) !== null) {
      usedKeys.add(match[2]);
    }
    return usedKeys;
  }

  async function processFileWithOpenAI(filePath, retryCount = 0) {
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const prompt = getRefactorPrompt(fileContent, retryCount);

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [{ role: 'user', content: prompt }],
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
      if (!validateUpdatedCode(parsed.updatedCode)) {
        if (retryCount < 2) {
          console.warn(`Retrying ${filePath} due to validation issues...`);
          return processFileWithOpenAI(filePath, retryCount + 1);
        }
        throw new Error("Validation failed for updated code after retries.");
      }
    }

    return parsed;
  }

  function getRefactorPrompt(fileContent, retryCount) {
    if (retryCount === 0) {
      return `
You are a Next.js and i18n expert.
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
6. Do not include any additional comments, explanations, or code fences.
7. Ensure the updated code compiles and retains functionality.

Here is the code:
${fileContent}
`;
    } else {
      // Retry prompt
      return `
The previous update attempt failed to produce valid JSON. Please correct it now:
1. Return valid JSON with the same structure:
{
  "needsUpdate": true/false,
  "updatedCode": "<full updated code if needed, otherwise empty>",
  "translations": {
    "<translationKey>": "<original string>"
  }
}
2. Ensure "updatedCode" is valid and retains original functionality.
3. No code fences, no extra commentary.

Here is the code that needs correction:
${fileContent}
`;
    }
  }

  function sanitizeCode(output) {
    // Remove triple backticks
    let sanitized = output.replace(/^\s*```[a-zA-Z]*\s*|\s*```$/g, '');
    if (!sanitized.endsWith('\n')) {
      sanitized += '\n';
    }
    return sanitized;
  }

  function validateUpdatedCode(newCode) {
    if (!newCode || newCode.trim().length === 0) {
      console.error("Validation failed: Updated code is empty.");
      return false;
    }
    // We could do more checks, but let's keep it simple.
    return true;
  }

  // ---------------------------------------------------------------------------
  // Function: find eligible files (similar to getEligibleFiles in your script)
  // ---------------------------------------------------------------------------
  function getEligibleFiles(dir) {
    let results = [];
    const ignoredDirs = ['node_modules', '.next', '.git', 'dist', 'build'];
    const validExtensions = ['.js', '.jsx', '.ts', '.tsx'];

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirs.includes(entry.name)) {
          results = results.concat(getEligibleFiles(fullPath));
        }
      } else if (entry.isFile()) {
        const ext = path.extname(fullPath);
        if (validExtensions.includes(ext)) {
          const content = fs.readFileSync(fullPath, 'utf8');
          if (
            !content.includes('useTranslation') &&
            !content.includes('t(') &&
            /<[a-zA-Z]|jsx>/.test(content)
          ) {
            results.push(fullPath);
          }
        }
      }
    }
    return results;
  }

  // ---------------------------------------------------------------------------
  // Step 1: Gather all files for i18n refactoring
  // ---------------------------------------------------------------------------
  console.log("🔍 Gathering files for i18n processing...");
  const eligibleFiles = getEligibleFiles(process.cwd());
  if (eligibleFiles.length === 0) {
    console.log("✅ No eligible files found for i18n refactoring. Skipping...");
  } else {
    console.log(`🚀 Sending ${eligibleFiles.length} file(s) to OpenAI in parallel...`);
    await processFiles(eligibleFiles);
    console.log("🎉 Finished i18n refactoring!");
  }

  // ---------------------------------------------------------------------------
  // Step 2: Auto-translate from default locale to others
  // ---------------------------------------------------------------------------
  console.log("🔤 Auto-translating from default locale to others...");
  await autoTranslateCommonJson();
  console.log("🎉 Done with auto-translation step!");

  // ---------------------------------------------------------------------------
  // Auto-translate default common.json to other locales
  // ---------------------------------------------------------------------------
  async function autoTranslateCommonJson() {
    const defaultCommonPath = path.join(LOCALE_FOLDER, DEFAULT_LOCALE, 'common.json');
    if (!fs.existsSync(defaultCommonPath)) {
      console.log(`No default common.json found at: ${defaultCommonPath}`);
      return;
    }

    const defaultData = JSON.parse(fs.readFileSync(defaultCommonPath, 'utf8'));
    if (!defaultData || Object.keys(defaultData).length === 0) {
      console.log(`Default locale (${DEFAULT_LOCALE}) common.json is empty or invalid.`);
      return;
    }

    const translationsPerLocale = {};

    for (const locale of additionalLocales) {
      console.log(`Translating from ${DEFAULT_LOCALE} to ${locale}...`);
      translationsPerLocale[locale] = {};

      for (const [key, value] of Object.entries(defaultData)) {
        if (!value || typeof value !== 'string') {
          translationsPerLocale[locale][key] = value;
          continue;
        }
        try {
          const translatedText = await openaiTranslateText(value, DEFAULT_LOCALE, locale);
          translationsPerLocale[locale][key] = translatedText;
        } catch (err) {
          console.error(`Error translating key "${key}": ${err.message}`);
          translationsPerLocale[locale][key] = value; // fallback
        }
      }
    }

    // Merge translations to each locale's common.json
    for (const locale of additionalLocales) {
      const localeCommonPath = path.join(LOCALE_FOLDER, locale, 'common.json');
      let existing = {};
      if (fs.existsSync(localeCommonPath)) {
        existing = JSON.parse(fs.readFileSync(localeCommonPath, 'utf8'));
      }
      const merged = { ...existing, ...translationsPerLocale[locale] };
      fs.writeFileSync(localeCommonPath, JSON.stringify(merged, null, 2), 'utf8');
      console.log(`✅ Wrote translations to ${localeCommonPath}`);
    }
  }

  async function openaiTranslateText(text, fromLang, toLang) {
    const prompt = `Please translate the following text from ${fromLang} to ${toLang}:
Text: "${text}".
Return only the translation, with no extra commentary.`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [{ role: 'user', content: prompt }],
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
}

// -------------------------------------------------------------------------------------
// Main "run" function that orchestrates everything
// -------------------------------------------------------------------------------------
(async function main() {
  try {
    if (!UNATTENDED) {
      await stepPromptForLocales();
    } else {
      console.log(
        `Running unattended with defaults: default locale = ${DEFAULT_LOCALE}, additional = ${ADDITIONAL_LOCALES}`
      );
    }

    // 2) Install deps
    stepInstallDependencies();

    // 3) Create next-i18next.config.js
    const allLocales = getAllLocales();
    stepCreateNextI18NextConfig(allLocales);

    // 4) Update next.config.js
    stepUpdateNextConfig();

    // 5) Create public/locales
    stepCreateLocalesFolder(allLocales);

    // 6) Detect pages & components dir
    let pagesDir = findDirectory('pages');
    if (!pagesDir) {
      // If we didn't find, prompt user
      pagesDir = await prompt("Enter the path for your pages folder", './app');
    }
    console.log(`Pages directory: ${pagesDir || '(not found)'}`);

    let componentsDir = findDirectory('components');
    if (!componentsDir) {
      componentsDir = await prompt("Enter the path for your components folder", './components');
    }
    console.log(`Components directory: ${componentsDir || '(not found)'}`);

    // 7) Create LanguagePicker
    stepCreateLanguagePicker(componentsDir, allLocales);

    // 8) i18n Refactor & translations in one go
    await runRefactorAndTranslations(allLocales);

    // 9) Done
    console.log("🎉 Multilingual setup & refactoring complete!");
    console.log(`Default locale: ${DEFAULT_LOCALE}`);
    console.log(`Additional locales: ${allLocales.slice(1).join(', ')}`);
    console.log(`LanguagePicker created at: ${path.join(componentsDir, 'LanguagePicker.js')}`);
    console.log("Try running your dev command (e.g., `yarn dev`) to confirm everything is working!");
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    process.exit(1);
  }
})();
