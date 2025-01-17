#!/usr/bin/env node

/**
 * setup-i18n.js
 *
 * Adds i18n to Next.js with optional cost/dry-run checking, package-manager selection,
 * verbose mode for additional logging, and scanning only specified directories (pages,
 * components, app, etc.).
 *
 * Usage:
 *   node setup-i18n.js [options]
 *
 * Options:
 *   -y, --yes            Run unattended (accept all defaults)
 *   -h, --help           Show help
 *   -m, --model          Specify OpenAI model (default: gpt-4o-mini)
 *   -c, --concurrency    Max concurrent OpenAI requests (default: 20)
 *   -l, --locale         Default locale (default: es)
 *   -a, --locales        Comma-separated additional locales (default: en,fr,de,zh,ar,pt,ru,ja)
 *   -f, --folder         Locale folder path (default: public/locales)
 *   -p, --package-manager Which package manager to use (yarn|npm|pnpm) (default: yarn)
 *   -v, --verbose        Enable verbose mode
 *   --dry-run            Only calculate approximate token usage & cost, then exit (no calls)
 *   --pages-dir          Manually specify your Next.js pages/app directory
 *   --components-dir     Manually specify your Next.js components directory
 *
 * Environment variables:
 *   OPENAI_API_KEY   Your OpenAI API key must be set in the environment
 *
 * Example:
 *   node setup-i18n.js --dry-run
 *   node setup-i18n.js -y -m gpt-4 -c 10 -l en -a "fr,de,it" -p npm
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Dynamically import fetch for Node < 18
let fetch;

// -------------------------------------------------------------------------------------
// Default / Reference Config
// -------------------------------------------------------------------------------------
const DEFAULTS = {
  OPENAI_MODEL: 'gpt-4o-mini',
  MAX_CONCURRENT_REQUESTS: 20,
  DEFAULT_LOCALE: 'es',
  DEFAULT_ADDITIONAL_LOCALES: 'en,fr,de,zh,ar,pt,ru,ja',
  LOCALE_FOLDER: 'public/locales',
  PACKAGE_MANAGER: 'yarn',
};

const PAGES_CANDIDATES = ['pages', 'src/pages', 'app', 'src/app'];
const COMPONENTS_CANDIDATES = ['components', 'src/components'];

// ----- Reference costs (per 1K tokens) - last update 01/16/2025 ------
const COST_PER_1K_TOKENS = {
  'input': {
    'gpt-o1-mini': 0.003,
    'gpt-4o': 0.0025,
    'gpt-4o-mini': 0.00015,
    'gpt-4': 0.03,
  },
  'output': {
    'gpt-o1-mini': 0.0120,
    'gpt-4o': 0.01,
    'gpt-4o-mini': 0.0006,
    'gpt-4': 0.06,
  }
};

// -------------------------------------------------------------------------------------
// Parse Command-Line Arguments
// -------------------------------------------------------------------------------------
let UNATTENDED = false;        // (i.e. -y/--yes)
let OPENAI_MODEL = DEFAULTS.OPENAI_MODEL;
let MAX_CONCURRENT_REQUESTS = DEFAULTS.MAX_CONCURRENT_REQUESTS;
let DEFAULT_LOCALE = DEFAULTS.DEFAULT_LOCALE;
let ADDITIONAL_LOCALES = DEFAULTS.DEFAULT_ADDITIONAL_LOCALES; // string, comma-separated
let LOCALE_FOLDER = DEFAULTS.LOCALE_FOLDER;
let PACKAGE_MANAGER = DEFAULTS.PACKAGE_MANAGER;
let DRY_RUN = false;           // (i.e. --dry-run)
let VERBOSE = false;           // (i.e. -v/--verbose)
let PAGES_DIR_OVERRIDE = null; // (i.e. --pages-dir)
let COMPONENTS_DIR_OVERRIDE = null; // (i.e. --components-dir)

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
  -p, --package-manager Which package manager to use (yarn|npm|pnpm) (default: ${DEFAULTS.PACKAGE_MANAGER})
  -v, --verbose        Enable verbose mode
  --dry-run            Only calculate approximate token usage & cost, then exit (no calls)
  --pages-dir          Manually specify your Next.js pages/app directory
  --components-dir     Manually specify your Next.js components directory

Environment variables:
  OPENAI_API_KEY   Your OpenAI API key must be set in the environment

Example:
  node ${path.basename(process.argv[1])} --dry-run
  node ${path.basename(process.argv[1])} -y -m gpt-4 -c 10 -l en -a "fr,de,it" -p npm
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
      case '-v':
      case '--verbose':
        VERBOSE = true;
        break;
      case '--dry-run':
        DRY_RUN = true;
        break;
      case '--pages-dir':
        PAGES_DIR_OVERRIDE = args[i + 1];
        i++;
        break;
      case '--components-dir':
        COMPONENTS_DIR_OVERRIDE = args[i + 1];
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
// Basic prompt function (only used if not in unattended mode)
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
// Step 1: Prompt for locales if interactive
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
// Step 2: Install dependencies (using yarn, npm, or pnpm)
// -------------------------------------------------------------------------------------
function stepInstallDependencies() {
  console.log("📦 Installing next-i18next & i18n dependencies...");

  const dependencies = [
    'next-i18next',
    'i18next',
    'react-i18next',
    'i18next-http-backend',
    'i18next-browser-languagedetector',
  ];

  let installCommand;
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

  if (VERBOSE) {
    console.log(`Package Manager: ${PACKAGE_MANAGER}`);
    console.log(`Install Command: ${installCommand}`);
  }

  execSync(installCommand, { stdio: 'inherit' });
}

// -------------------------------------------------------------------------------------
// Step 3: Create/Update next-i18next.config.js
// -------------------------------------------------------------------------------------
function stepCreateNextI18NextConfig() {
  const localesArray = getAllLocales();
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
function stepCreateLocalesFolder() {
  const allLocales = getAllLocales();
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
// Updated helper to handle overrides & prompts if needed
// -------------------------------------------------------------------------------------
async function detectOrPromptPagesComponentsDir(projectDir) {
  // If user manually provided both overrides, just verify them:
  if (PAGES_DIR_OVERRIDE && COMPONENTS_DIR_OVERRIDE) {
    const verifiedPages = await verifyDirectory(PAGES_DIR_OVERRIDE, 'pages/app');
    const verifiedComponents = await verifyDirectory(COMPONENTS_DIR_OVERRIDE, 'components');
    return {
      pagesDir: verifiedPages,
      componentsDir: verifiedComponents
    };
  }

  // If user manually provided one override, verify it, then auto-detect the other
  if (PAGES_DIR_OVERRIDE && !COMPONENTS_DIR_OVERRIDE) {
    const verifiedPages = await verifyDirectory(PAGES_DIR_OVERRIDE, 'pages/app');
    const autoComponents = findFirstExistingCandidate(projectDir, COMPONENTS_CANDIDATES);
    if (autoComponents) {
      return {
        pagesDir: verifiedPages,
        componentsDir: autoComponents,
      };
    }
    // If no auto-detect for components, prompt user (if not UNATTENDED)
    const finalComponents = await promptDirectoryIfNeeded(
      "components directory",
      COMPONENTS_CANDIDATES
    );
    return {
      pagesDir: verifiedPages,
      componentsDir: finalComponents,
    };
  }

  if (!PAGES_DIR_OVERRIDE && COMPONENTS_DIR_OVERRIDE) {
    const verifiedComponents = await verifyDirectory(COMPONENTS_DIR_OVERRIDE, 'components');
    const autoPages = findFirstExistingCandidate(projectDir, PAGES_CANDIDATES);
    if (autoPages) {
      return {
        pagesDir: autoPages,
        componentsDir: verifiedComponents,
      };
    }
    const finalPages = await promptDirectoryIfNeeded("pages/app directory", PAGES_CANDIDATES);
    return {
      pagesDir: finalPages,
      componentsDir: verifiedComponents,
    };
  }

  // If no overrides, auto-detect both
  const { appDir, componentsDir } = await detectNextAppAndComponents(projectDir);
  return {
    pagesDir: appDir,
    componentsDir,
  };
}

/**
 * If directory is valid, return absolute path, otherwise prompt if not UNATTENDED.
 */
async function verifyDirectory(dirPath, label) {
  const fullPath = path.resolve(dirPath);
  if (fs.existsSync(fullPath) && fs.lstatSync(fullPath).isDirectory()) {
    return fullPath;
  }

  if (UNATTENDED) {
    // In unattended mode, if user-provided path is invalid, just error out
    throw new Error(`❌ The specified ${label} directory "${dirPath}" does not exist or is not a directory.`);
  } else {
    console.log(`❌ The specified ${label} directory "${dirPath}" is invalid. Please provide a valid path.`);
    return promptDirectory(label, fullPath);
  }
}

/**
 * Prompts user for a directory if auto-detect fails or user-provided path was invalid.
 */
async function promptDirectoryIfNeeded(label, candidates) {
  // Try auto-detect from the candidates
  const projectDir = process.cwd();
  const found = findFirstExistingCandidate(projectDir, candidates);
  if (found) {
    return found;
  }
  // Otherwise, prompt
  return promptDirectory(label);
}

/**
 * Actually ask the user for a directory, verifying it exists.
 */
async function promptDirectory(label, defaultValue = '.') {
  let result;
  while (!result) {
    const answer = await prompt(
      `Enter a valid path for your ${label} (relative or absolute)`,
      defaultValue
    );
    const absPath = path.resolve(answer);
    if (fs.existsSync(absPath) && fs.lstatSync(absPath).isDirectory()) {
      result = absPath;
    } else {
      console.log(`❌ Directory "${answer}" not found or is not a directory. Please try again.`);
    }
  }
  return result;
}

// -------------------------------------------------------------------------------------
// Helper: detectNextAppAndComponents
// -------------------------------------------------------------------------------------
async function detectNextAppAndComponents(projectDir) {
  // 1. Check if it's a Next.js project (package.json or next.config.js)
  if (!isNextProject(projectDir)) {
    throw new Error(`❌ No Next.js project detected!`);
  }

  // 2. Find the first existing "pages/app" directory
  const appDir = findFirstExistingCandidate(projectDir, PAGES_CANDIDATES);

  // 3. Find the first existing "components" directory
  const componentsDir = findFirstExistingCandidate(projectDir, COMPONENTS_CANDIDATES);

  // 4. If neither is found, we throw an error so we can proceed to prompt or fail
  if (!appDir && !componentsDir) {
    throw new Error(
      `❌ No common Next.js "pages/app" or "components" directory found.`
    );
  }
  // We'll allow partial detection; if only one is found, that's still okay
  return { appDir, componentsDir };
}

/**
 * Checks if the project contains a 'next' dependency or a 'next.config.js' file.
 */
function isNextProject(projectDir) {
  const packageJsonPath = path.join(projectDir, 'package.json');
  let foundNext = false;

  if (fs.existsSync(packageJsonPath)) {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const deps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };
    foundNext = Boolean(deps && deps.next);
  }

  const nextConfigPath = path.join(projectDir, 'next.config.js');
  const hasNextConfig = fs.existsSync(nextConfigPath);

  return foundNext || hasNextConfig;
}

/**
 * Loops through a list of possible directory candidates.
 * Returns the *first* one that exists on disk or `undefined` if none exist.
 */
function findFirstExistingCandidate(projectDir, candidates) {
  for (const candidate of candidates) {
    const fullPath = path.join(projectDir, candidate);
    if (fs.existsSync(fullPath) && fs.lstatSync(fullPath).isDirectory()) {
      return fullPath;
    }
  }
  return undefined;
}

// -------------------------------------------------------------------------------------
// Step 6: Create a LanguagePicker component
// -------------------------------------------------------------------------------------
function stepCreateLanguagePicker(componentsDir) {
  const allLocales = getAllLocales();
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
// We define a function getEligibleFiles to recursively find files with some JSX content.
// -------------------------------------------------------------------------------------
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
        // Must have some JSX-ish syntax, and not already using i18n
        if (
          /<[a-zA-Z]|jsx>/.test(content) && // indicates some JSX or HTML-like syntax
          !content.includes('useTranslation') &&
          !content.includes('t(["\']')
        ) {
          results.push(fullPath);
        } else if (VERBOSE) {
          console.log(`- Skipping non matching criteria file: ${fullPath}`)
        }
      }
    }
  }
  return results;
}


async function runRefactorAndTranslations(directoriesToScan) {
  // We'll embed the entire logic that was in refactor-i18n.js here.

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

  // Gather eligible files from the specified directories:
  let eligibleFiles = [];
  for (const dir of directoriesToScan) {
    if (dir && fs.existsSync(dir)) {
      const subset = getEligibleFiles(dir);
      eligibleFiles = eligibleFiles.concat(subset);
    }
  }

  if (eligibleFiles.length === 0) {
    console.log("✅ No eligible files found for i18n refactoring in those directories. Skipping to auto-translation...");
  } else {
    console.log(`Found ${eligibleFiles.length} file(s) to process with OpenAI...`);
    if (VERBOSE) {
      console.log("List of files to refactor:");
      eligibleFiles.forEach((f) => console.log(` - ${f}`));
    }
  }

  // DRY_RUN scenario
  if (DRY_RUN) {
    // Show cost estimate and then exit
    await doApproximateCostCheck(eligibleFiles, true);
    return;
  }
  // Otherwise, if interactive, confirm cost
  else if (!UNATTENDED) {
    const proceed = await doApproximateCostCheck(eligibleFiles, false);
    if (!proceed) {
      console.log("Aborting per user choice. No OpenAI calls will be made.");
      return;
    }
  }

  return eligibleFiles;
}

// -------------------------------------------------------------------------------------
// Token cost check
// -------------------------------------------------------------------------------------
async function doApproximateCostCheck(eligibleFiles, isDryRunMode) {
  const approxTokensNeeded = estimateTokensForFiles(eligibleFiles);
  const inputRate = COST_PER_1K_TOKENS.input[OPENAI_MODEL] || 0.03; // fallback
  const outputRate = COST_PER_1K_TOKENS.output[OPENAI_MODEL] || 0.03; // fallback
  const approxInputCost = (approxTokensNeeded / 1000) * inputRate;
  const approxOutputCost = (approxTokensNeeded / 1000) * outputRate;

  console.log(`\n--- COST ESTIMATE ---`);
  console.log(`Files count: ${eligibleFiles.length}`);
  console.log(`Model: ${OPENAI_MODEL}`);
  console.log(`Approx. input tokens needed: ${approxTokensNeeded} (using same to calculate output)`);
  console.log(`Estimated costs:`);
  console.log(`- input: ~$${approxInputCost.toFixed(4)} (at ${inputRate}/1k tokens)`);
  console.log(`- output: ~$${approxOutputCost.toFixed(4)} (at ${outputRate}/1k tokens)`);
  console.log(`- TOTAL: ~$${(approxOutputCost + approxOutputCost).toFixed(4)}\n`);


  if (isDryRunMode) {
    console.log("Dry-run mode only. No calls made.");
    return false;
  }

  const answer = await prompt(
    "Do you want to proceed with these AI calls? (yes/no)",
    "no"
  );
  return /^y(es)?$/i.test(answer);
}

function estimateTokensForFiles(files) {
  let totalTokens = 0;
  for (const filePath of files) {
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const overhead = 500; // approximate overhead
    const combinedContent = getRefactorPrompt(fileContent, 0) + overhead;
    // approximate token count: ~4 chars per token
    const charCount = combinedContent.length;
    const tokens = Math.ceil(charCount / 4);
    totalTokens += tokens;
  }
  return totalTokens;
}

// -------------------------------------------------------------------------------------
// Actual file refactoring
// -------------------------------------------------------------------------------------
async function processFiles(files) {
  const allNewKeys = {};

  // concurrency
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

            // Collect used keys
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

  if (Object.keys(allNewKeys).length > 0) {
    updateCommonJson(allNewKeys, getAllLocales());
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

// Scan updated code for 't("key")' usage
function extractUsedKeys(code) {
  const pattern = /t\((["'])([^"']+)\1\)/g;
  const usedKeys = new Set();
  let match;
  while ((match = pattern.exec(code)) !== null) {
    usedKeys.add(match[2]);
  }
  return usedKeys;
}

// Actually call OpenAI to refactor
async function processFileWithOpenAI(filePath, retryCount = 0) {
  const fileContent = fs.readFileSync(filePath, 'utf8');
  const prompt = getRefactorPrompt(fileContent, retryCount);

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
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
  let prompt = `
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
8. Do not delete existing comments unless strictly necessary for functionality or to fix errors.

Here is the code:
${fileContent}
`;

  if (retryCount > 0) {
    prompt = `The previous update attempt failed to produce valid JSON. Please correct it now:\n${prompt}`;
  }

  return prompt;
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
// Auto-translate default common.json to other locales
// ---------------------------------------------------------------------------
async function autoTranslateCommonJson() {
  const allLocales = getAllLocales();
  const additionalLocales = allLocales.filter((loc) => loc !== DEFAULT_LOCALE);

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
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
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

// -------------------------------------------------------------------------------------
// Main "run" function that orchestrates everything
// -------------------------------------------------------------------------------------
(async function main() {
  try {
    if (VERBOSE) {
      console.log("Parsing arguments and starting i18n setup script...");
    }

    // 1) If interactive, prompt for locales
    if (!UNATTENDED) {
      await stepPromptForLocales();
    } else {
      console.log(
        `Running unattended with defaults: default locale = ${DEFAULT_LOCALE}, additional = ${ADDITIONAL_LOCALES}`
      );
    }

    // 2) Detect or override pages & components dir
    const projectDir = process.cwd();
    if (!isNextProject(projectDir)) {
      throw new Error(`❌ No Next.js project detected!`);
    }

    const { pagesDir, componentsDir } = await detectOrPromptPagesComponentsDir(projectDir);

    // 3) i18n Refactor & translations
    const directoriesToScan = [];
    if (pagesDir && fs.existsSync(pagesDir)) {
      directoriesToScan.push(pagesDir);
    }
    if (componentsDir && fs.existsSync(componentsDir)) {
      directoriesToScan.push(componentsDir);
    }

    const eligibleFiles = await runRefactorAndTranslations(directoriesToScan);

    if (!!eligibleFiles && eligibleFiles.length > 0) {
      // 4) Create public/locales
      stepCreateLocalesFolder();

      // 5) If we get here, do actual refactoring
      console.log("🚀 Sending files to OpenAI in parallel...");
      await processFiles(eligibleFiles);
      console.log("🎉 Finished i18n refactoring!");

      // 6) Finally, auto-translate from default locale to others
      console.log("🔤 Auto-translating from default locale to others...");
      await autoTranslateCommonJson();
      console.log("🎉 Done with auto-translation step!");

      // 7) Create LanguagePicker
      stepCreateLanguagePicker(componentsDir);

      // 8) Install deps
      stepInstallDependencies();

      // 9) Create next-i18next.config.js
      stepCreateNextI18NextConfig();

      // 10) Update next.config.js
      stepUpdateNextConfig();

      // Done
      console.log("\n🎉 Multilingual setup & refactoring complete!");
      console.log(`Default locale: ${DEFAULT_LOCALE}`);
      console.log(`Additional locales: ${getAllLocales().slice(1).join(', ')}`);
      console.log(`Pages/app directory: ${pagesDir}`);
      console.log(`Components directory: ${componentsDir}`);
      console.log(`LanguagePicker created at: ${path.join(componentsDir || '.', 'LanguagePicker.js')}`);
      console.log("\nTry running your dev command (e.g., `yarn dev`) to confirm everything is working!\n");

    } else {
      console.log("\nℹ️No changes made to the project.");
    }
  } catch (error) {
    console.trace(error);
    process.exit(1);
  }
})();
