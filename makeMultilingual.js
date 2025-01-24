#!/usr/bin/env node

/**
 * setup-i18n.js
 *
 * Adds i18n to Next.js using next-intl with optional cost/dry-run checking,
 * package-manager selection, verbose mode for additional logging, scanning only
 * specified directories (pages, components, app, etc.), and skipping directly
 * to the build step via `-b`.
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
 *   -b, --build-only     Skip all i18n setup steps & jump straight to build checks
 *
 * Environment variables:
 *   OPENAI_API_KEY   Your OpenAI API key must be set in the environment
 *
 * Example:
 *   node setup-i18n.js --dry-run
 *   node setup-i18n.js -y -m gpt-4 -c 10 -l en -a "fr,de,it" -p npm
 *   node setup-i18n.js -b
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
  MAX_CONCURRENT_REQUESTS: 30,
  DEFAULT_LOCALE: 'es',
  DEFAULT_ADDITIONAL_LOCALES: 'en,fr,de,zh,ar,pt,ru,ja',
  LOCALE_FOLDER: 'public/locales',
  PACKAGE_MANAGER: 'yarn',
};

const PAGES_CANDIDATES = ['pages', 'src/pages', 'app', 'src/app'];
const COMPONENTS_CANDIDATES = ['components', 'src/components'];

// ----- Reference costs (per 1K tokens) - last update 01/16/2025 ------
const COST_PER_1K_TOKENS = {
  input: {
    'gpt-4o': 0.0025,
    'gpt-4o-mini': 0.00015,
    'gpt-4': 0.03,
  },
  output: {
    'gpt-4o': 0.01,
    'gpt-4o-mini': 0.0006,
    'gpt-4': 0.06,
  },
};

// -------------------------------------------------------------------------------------
// Parse Command-Line Arguments
// -------------------------------------------------------------------------------------
let UNATTENDED = false;
let OPENAI_MODEL = DEFAULTS.OPENAI_MODEL;
let MAX_CONCURRENT_REQUESTS = DEFAULTS.MAX_CONCURRENT_REQUESTS;
let DEFAULT_LOCALE = DEFAULTS.DEFAULT_LOCALE;
let ADDITIONAL_LOCALES = DEFAULTS.DEFAULT_ADDITIONAL_LOCALES;
let LOCALE_FOLDER = DEFAULTS.LOCALE_FOLDER;
let PACKAGE_MANAGER = DEFAULTS.PACKAGE_MANAGER;
let DRY_RUN = false;
let VERBOSE = false;
let PAGES_DIR_OVERRIDE = null;
let COMPONENTS_DIR_OVERRIDE = null;
let BUILD_ONLY = false;

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
  -b, --build-only     Skip all i18n setup steps & jump straight to build checks

Environment variables:
  OPENAI_API_KEY   Your OpenAI API key must be set in the environment

Example:
  node ${path.basename(process.argv[1])} --dry-run
  node ${path.basename(process.argv[1])} -y -m gpt-4 -c 10 -l en -a "fr,de,it" -p npm
  node ${path.basename(process.argv[1])} -b
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
      case '-b':
      case '--build-only':
        BUILD_ONLY = true;
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
// Global Vars
// -------------------------------------------------------------------------------------
const previosFixIntentsByFile = {};

// -------------------------------------------------------------------------------------
// Consts
// -------------------------------------------------------------------------------------
const FIX_ERROR = 'FIX_ERROR';
const REFACTOR = 'REFACTOR';
const EXTRACT_ERRORS = 'EXTRACT_ERRORS';
const MAX_BUILD_ATTEMPTS = 5;

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
  return [DEFAULT_LOCALE, ...trimmed];
}

// -------------------------------------------------------------------------------------
// Step 2: Install next-intl (using yarn, npm, or pnpm)
// -------------------------------------------------------------------------------------
function stepInstallDependencies() {
  console.log('📦 Installing next-intl ...');

  const dependencies = ['next-intl'];

  let installCommand;
  switch (PACKAGE_MANAGER) {
    case 'npm':
      installCommand = `npm install --save ${dependencies.join(' ')}`;
      break;
    case 'pnpm':
      installCommand = `pnpm add ${dependencies.join(' ')}`;
      break;
    case 'yarn':
    default:
      installCommand = `yarn add ${dependencies.join(' ')}`;
      break;
  }

  if (VERBOSE) {
    console.log(`Package Manager: ${PACKAGE_MANAGER}`);
    console.log(`Install Command: ${installCommand}`);
  }

  execSync(installCommand, { stdio: 'inherit' });
}

// -------------------------------------------------------------------------------------
// Step 3: Create public/locales structure
// -------------------------------------------------------------------------------------
function stepCreateLocalesFolder() {
  const allLocales = getAllLocales();
  console.log('📁 Creating localization folder structure...');
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
// Helper to handle overrides & prompts for pages/app and components directory
// -------------------------------------------------------------------------------------
async function detectOrPromptPagesComponentsDir(projectDir) {
  if (PAGES_DIR_OVERRIDE && COMPONENTS_DIR_OVERRIDE) {
    const verifiedPages = await verifyDirectory(PAGES_DIR_OVERRIDE, 'pages/app');
    const verifiedComponents = await verifyDirectory(COMPONENTS_DIR_OVERRIDE, 'components');
    return {
      pagesDir: verifiedPages,
      componentsDir: verifiedComponents,
    };
  }

  if (PAGES_DIR_OVERRIDE && !COMPONENTS_DIR_OVERRIDE) {
    const verifiedPages = await verifyDirectory(PAGES_DIR_OVERRIDE, 'pages/app');
    const autoComponents = findFirstExistingCandidate(projectDir, COMPONENTS_CANDIDATES);
    if (autoComponents) {
      return {
        pagesDir: verifiedPages,
        componentsDir: autoComponents,
      };
    }
    const finalComponents = await promptDirectoryIfNeeded('components directory', COMPONENTS_CANDIDATES);
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
    const finalPages = await promptDirectoryIfNeeded('pages/app directory', PAGES_CANDIDATES);
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

async function verifyDirectory(dirPath, label) {
  const fullPath = path.resolve(dirPath);
  if (fs.existsSync(fullPath) && fs.lstatSync(fullPath).isDirectory()) {
    return fullPath;
  }

  if (UNATTENDED) {
    throw new Error(`❌ The specified ${label} directory "${dirPath}" does not exist or is not a directory.`);
  } else {
    console.log(`❌ The specified ${label} directory "${dirPath}" is invalid. Please provide a valid path.`);
    return promptDirectory(label, fullPath);
  }
}

async function promptDirectoryIfNeeded(label, candidates) {
  const projectDir = process.cwd();
  const found = findFirstExistingCandidate(projectDir, candidates);
  if (found) {
    return found;
  }
  return promptDirectory(label);
}

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
  if (!isNextProject(projectDir)) {
    throw new Error(`❌ No Next.js project detected!`);
  }

  const appDir = findFirstExistingCandidate(projectDir, PAGES_CANDIDATES);
  const componentsDir = findFirstExistingCandidate(projectDir, COMPONENTS_CANDIDATES);

  if (!appDir && !componentsDir) {
    throw new Error(`❌ No common Next.js "pages/app" or "components" directory found.`);
  }
  return { appDir, componentsDir };
}

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
// Step: Create a LanguagePicker component that uses next-intl
// -------------------------------------------------------------------------------------
function stepCreateLanguagePicker(componentsDir) {
  const allLocales = getAllLocales();
  console.log('🛠 Creating LanguagePicker component...');

  if (componentsDir && !fs.existsSync(componentsDir)) {
    fs.mkdirSync(componentsDir, { recursive: true });
    console.log(`Created '${componentsDir}' directory.`);
  }

  const jsArray = `[${allLocales.map((l) => `"${l}"`).join(', ')}]`;

  const pickerPath = path.join(componentsDir, 'LanguagePicker.tsx');
  // Using next-intl: <Link> with locale + useTranslations('common')
  const content = `
'use client';

import Link from 'next-intl/link';
import { useTranslations, useLocale } from 'next-intl';

export default function LanguagePicker() {
  const t = useTranslations('common');
  const currentLocale = useLocale();

  const availableLocales = ${jsArray};

  return (
    <div style={{ margin: '1rem 0' }}>
      <h3>{t('selectLanguage')}:</h3>
      {availableLocales.map((lng) => (
        <Link key={lng} href="/" locale={lng} style={{ marginRight: '8px' }}>
          {lng.toUpperCase()}
          {lng === currentLocale ? ' (current)' : ''}
        </Link>
      ))}
    </div>
  );
}
`.trimStart();

  fs.writeFileSync(pickerPath, content, 'utf8');
  console.log(`✅ Created LanguagePicker.tsx in '${componentsDir}'`);
  console.log('ℹ️ Make sure you have a <NextIntlClientProvider> wrapping your app so translations work.');
}

// -------------------------------------------------------------------------------------
// Gather candidate files for i18n refactoring
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
        // Heuristic: has JSX but does not yet have useTranslations('common') calls
        if (
          /<[a-zA-Z]|jsx>/.test(content) &&
          !content.includes('useTranslations') &&
          !content.includes('t(["\']')
        ) {
          results.push(fullPath);
        } else if (VERBOSE) {
          console.log(`- Skipping non matching criteria file: ${fullPath}`);
        }
      }
    }
  }
  return results;
}

async function runRefactorAndTranslations(directoriesToScan) {
  if (!fetch) {
    const { default: f } = await import('node-fetch');
    fetch = f;
  }

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) {
    console.error('❌ Error: OPENAI_API_KEY is not set in the environment.');
    return;
  }

  let eligibleFiles = [];
  for (const dir of directoriesToScan) {
    if (dir && fs.existsSync(dir)) {
      const subset = getEligibleFiles(dir);
      eligibleFiles = eligibleFiles.concat(subset);
    }
  }

  if (eligibleFiles.length === 0) {
    console.log('✅ No eligible files found for i18n refactoring. Skipping to auto-translation...');
  } else {
    console.log(`Found ${eligibleFiles.length} file(s) to process with OpenAI...`);
    if (VERBOSE) {
      console.log('List of files to refactor:');
      eligibleFiles.forEach((f) => console.log(` - ${f}`));
    }
  }

  if (DRY_RUN) {
    await doApproximateCostCheck(eligibleFiles, true);
    return;
  } else if (!UNATTENDED) {
    const proceed = await doApproximateCostCheck(eligibleFiles, false);
    if (!proceed) {
      console.log('Aborting per user choice. No OpenAI calls will be made.');
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
  const inputRate = COST_PER_1K_TOKENS.input[OPENAI_MODEL] || 0.03;
  const outputRate = COST_PER_1K_TOKENS.output[OPENAI_MODEL] || 0.03;
  const approxInputCost = (approxTokensNeeded / 1000) * inputRate;
  const approxOutputCost = (approxTokensNeeded / 1000) * outputRate;

  console.log(`\n--- COST ESTIMATE ---`);
  console.log(`Files count: ${eligibleFiles.length}`);
  console.log(`Model: ${OPENAI_MODEL}`);
  console.log(`Approx. input tokens needed: ${approxTokensNeeded} (using same to calculate output)`);
  console.log(`Estimated costs:`);
  console.log(`- input: ~$${approxInputCost.toFixed(4)} (at ${inputRate}/1k tokens)`);
  console.log(`- output: ~$${approxOutputCost.toFixed(4)} (at ${outputRate}/1k tokens)`);
  console.log(`- TOTAL: ~$${(approxInputCost + approxOutputCost).toFixed(4)}\n`);

  if (isDryRunMode) {
    console.log('Dry-run mode only. No calls made.');
    return false;
  }

  const answer = await prompt('Do you want to proceed with these AI calls? (yes/no)', 'no');
  return /^y(es)?$/i.test(answer);
}

function estimateTokensForFiles(files) {
  let totalTokens = 0;
  for (const filePath of files) {
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const overhead = 500;
    const combinedContent = getTaskPrompt(REFACTOR, fileContent, 0) + overhead;
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

  const batches = [];
  for (let i = 0; i < files.length; i += MAX_CONCURRENT_REQUESTS) {
    batches.push(files.slice(i, i + MAX_CONCURRENT_REQUESTS));
  }

  for (const batch of batches) {
    await Promise.all(
      batch.map(async (filePath) => {
        try {
          const fileContent = fs.readFileSync(filePath, 'utf8');
          const prompt = getTaskPrompt(REFACTOR, fileContent);
          const result = await processFileWithOpenAI(prompt, filePath);
          if (result.needsUpdate) {
            fs.writeFileSync(filePath, result.updatedCode, 'utf8');
            console.log(`✅ Updated file: ${filePath}`);

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

function extractUsedKeys(code) {
  const pattern = /t\((["'])([^"']+)\1\)/g;
  const usedKeys = new Set();
  let match;
  while ((match = pattern.exec(code)) !== null) {
    usedKeys.add(match[2]);
  }
  return usedKeys;
}

async function processFileWithOpenAI(prompt, filePath, retryCount = 0) {
  if (!fetch) {
    const { default: f } = await import('node-fetch');
    fetch = f;
  }

  const body = {
    model: OPENAI_MODEL,
    messages: [{ role: 'user', content: prompt }],
  };
  if (OPENAI_MODEL.includes('gpt-')) {
    body.max_tokens = 4096;
    body.temperature = 0.2;
  } else {
    body.max_completion_tokens = 3000;
  }
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API Error: ${response.status} - ${error}`);
  }

  const result = await response.json();
  const gptMessage = result?.choices?.[0]?.message?.content;
  if (!gptMessage) {
    throw new Error('Invalid response from OpenAI: No content returned.');
  }

  let parsed;
  try {
    parsed = JSON.parse(gptMessage.trim());
  } catch (err) {
    if (retryCount < 2) {
      console.warn(`Retrying ${filePath} due to JSON parse error...`);
      return processFileWithOpenAI(prompt, filePath, retryCount + 1);
    }
    throw new Error(`Failed to parse JSON: ${err.message}`);
  }

  if (parsed.needsUpdate) {
    parsed.updatedCode = sanitizeCode(parsed.updatedCode);
    if (!validateUpdatedCode(parsed.updatedCode)) {
      if (retryCount < 2) {
        console.warn(`Retrying ${filePath} due to validation issues...`);
        return processFileWithOpenAI(prompt, filePath, retryCount + 1);
      }
      throw new Error('Validation failed for updated code after retries.');
    }
  }

  return parsed;
}

// NEW HELPER for logs-based processing
async function processLogsWithOpenAI(logs, retryCount = 0) {
  if (!fetch) {
    const { default: f } = await import('node-fetch');
    fetch = f;
  }

  const promptText = getTaskPrompt(EXTRACT_ERRORS, logs, retryCount);
  const body = {
    model: OPENAI_MODEL,
    messages: [{ role: 'user', content: promptText }],
  };

  if (OPENAI_MODEL.includes('gpt-')) {
    body.max_tokens = 4000;
    body.temperature = 0.2;
  } else {
    body.max_completion_tokens = 3000;
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API Error: ${response.status} - ${error}`);
  }

  const result = await response.json();
  const gptMessage = result?.choices?.[0]?.message?.content;
  if (!gptMessage) {
    throw new Error('Invalid response from OpenAI: No content returned.');
  }

  let parsed;
  try {
    parsed = JSON.parse(gptMessage.trim());
  } catch (err) {
    if (retryCount < 2) {
      console.warn(`Retrying logs-based extraction due to JSON parse error...`);
      return processLogsWithOpenAI(logs, retryCount + 1);
    }
    throw new Error(`Failed to parse JSON: ${err.message}`);
  }

  if (!parsed.extractedErrors || !Array.isArray(parsed.extractedErrors)) {
    throw new Error('Missing or invalid "extractedErrors" in the AI response.');
  }

  return parsed.extractedErrors;
}

function getTaskPrompt(task, fileContent = '', retryCount = 0, compileErrors = '', previousFixIntents = []) {
  // Define the core instructions for each task in an object
  const taskPrompts = {
    REFACTOR: `
You are a Next.js and i18n expert using the "next-intl" package.
You will receive a Next.js file that may or may not contain user-facing strings.

Follow these rules carefully:
1. Identify all user-facing strings, including:
   - Static text within JSX elements.
   - Text within attributes (e.g., alt, title).
   - Dynamic strings constructed using template literals or string concatenation.
2. Replace identified strings with \`t('namespace.key')\` using \`useTranslations('namespace')\` from next-intl.
   - For pluralization, use the appropriate next-intl formatting methods.
3. Add an import statement for \`useTranslations\` from \`"next-intl"\` if not present.
4. Organize translation keys hierarchically based on the file structure or component hierarchy for better maintainability.
5. Add a "translations" object mapping each new key to its original string.
   - Ensure that dynamic parts of strings are represented using placeholders.
6. Do NOT modify existing comments, formatting, console.log statements, or any code not strictly related to end-user-facing text.
7. If partial i18n exists, reuse existing keys for matching strings; do not duplicate or rename them.
8. If no changes are needed, set "needsUpdate" to false and leave "updatedCode" empty.
9. Return ONLY valid JSON, with no code fences or extra commentary.
10. The JSON structure must be:

{
  "needsUpdate": true | false,
  "updatedCode": "<entire updated file if needed or empty string>",
  "translations": {
    "namespace.key": "Original string",
    ...
  }
}

11. The updated code must compile, preserve functionality, and keep all existing comments intact.
`.trim(),

    FIX_ERROR: `
Fix the following code that caused a build error:

Current error: ${compileErrors}

Rules:
1. Analyze the error message and identify the root cause.
2. Modify the code to resolve the error while preserving existing functionality.
3. Ensure type safety and adherence to best practices.
4. Return ONLY valid JSON. No code fences or extra commentary.
5. The JSON must have this structure:

{
  "fixExplanation": "Short but detailed fix explanation",
  "updatedCode": "<full updated code>"
}

6. Do not fix anything unrelated to the compile error. Keep all comments and formatting intact.
`.trim(),

    EXTRACT_ERRORS: `
We have a Next.js build log that may contain multiple errors.

Your task:
1. Parse all errors and categorize them based on their type (e.g., Syntax Error, Type Error, Module Not Found, etc.).
2. Return ONLY valid JSON, no extra commentary.
3. The JSON must have this structure:

{
  "extractedErrors": [
    {
      "filePath": "Absolute or relative path to file (if any)",
      "errorType": "Category of the error",
      "errorDescription": "The full error message/description"
    },
    ...
  ]
}

4. If no errors are found, return "extractedErrors" as an empty array.
5. If the log format is irregular, do your best to extract meaningful file paths, error types, and descriptions.
`.trim(),

//     ADD_TYPE_DECLARATIONS: `
// Some modules in your project lack TypeScript type declarations.

// Your task:
// 1. Identify modules without type declarations.
// 2. Generate appropriate type declaration files (*.d.ts) for these modules.
// 3. Ensure that the type declarations are accurate and comprehensive.
// 4. Return ONLY valid JSON, no code fences or extra commentary.
// 5. The JSON must have this structure:

// {
//   "typeDeclarations": {
//     "module-name": "Type declaration content as a string",
//     ...
//   }
// }
// `.trim(),

//     OPTIMIZE_IMPORTS: `
// Organize and optimize the import statements in the provided Next.js file.

// Rules:
// 1. Group imports by their source:
//    - External modules (e.g., React, next-intl) first.
//    - Internal modules (e.g., components, utils) next.
//    - Styles or assets last.
// 2. Remove any unused imports.
// 3. Order imports alphabetically within each group.
// 4. Ensure there are no duplicate import statements.
// 5. Return ONLY valid JSON, no code fences or extra commentary.
// 6. The JSON structure must be:

// {
//   "needsUpdate": true | false,
//   "updatedCode": "<entire updated file if needed or empty string>"
// }

// 7. If no changes are needed, set "needsUpdate" to false and leave "updatedCode" empty.
// `.trim(),
  };

  // Check if task is valid
  if (!Object.prototype.hasOwnProperty.call(taskPrompts, task)) {
    throw new Error('Invalid TASK identifier.');
  }

  // Base prompt for the chosen task
  let prompt = taskPrompts[task];

  // If we have file content, append it
  if (fileContent) {
    prompt += `

Here is the code/log content:
${fileContent}
`;
  }

  // If we have previous fix attempts, include them so AI knows what went wrong
  if (previousFixIntents.length > 0) {
    prompt += `

Previous fix attempts:
${previousFixIntents.join('\n')}
`;
  }

  // If we're retrying because the AI produced invalid JSON, prepend a warning
  if (retryCount > 0) {
    prompt = `IMPORTANT: The previous attempt failed to produce valid JSON. Ensure that your response strictly follows the JSON structure without any additional text, code fences, or commentary. Please adhere to the following format:\n\n${prompt}`;
  }

  return prompt;
}


function sanitizeCode(output) {
  let sanitized = output.replace(/^\s*```[a-zA-Z]*\s*|\s*```$/g, '');
  if (!sanitized.endsWith('\n')) {
    sanitized += '\n';
  }
  return sanitized;
}

function validateUpdatedCode(newCode) {
  if (!newCode || newCode.trim().length === 0) {
    console.error('Validation failed: Updated code is empty.');
    return false;
  }
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

  // Helper to process translation for a single locale
  async function translateLocale(locale) {
    console.log(`Translating from ${DEFAULT_LOCALE} to ${locale}...`);
    const translations = {};

    for (const [key, value] of Object.entries(defaultData)) {
      if (!value || typeof value !== 'string') {
        translations[key] = value;
        continue;
      }
      try {
        const translatedText = await openaiTranslateText(value, DEFAULT_LOCALE, locale);
        translations[key] = translatedText;
      } catch (err) {
        console.error(`Error translating key "${key}": ${err.message}`);
        translations[key] = value;
      }
    }

    translationsPerLocale[locale] = translations;
  }

  const localeBatches = [];
  for (let i = 0; i < additionalLocales.length; i += MAX_CONCURRENT_REQUESTS) {
    localeBatches.push(additionalLocales.slice(i, i + MAX_CONCURRENT_REQUESTS));
  }

  for (const batch of localeBatches) {
    await Promise.all(batch.map((locale) => translateLocale(locale)));
  }

  // Write translated files
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
  if (!fetch) {
    const { default: f } = await import('node-fetch');
    fetch = f;
  }

  const prompt = `Please translate the following text from ${fromLang} to ${toLang}:
Text: "${text}".
Return only the translation, with no extra commentary.`;

  const body = {
    model: OPENAI_MODEL,
    messages: [{ role: 'user', content: prompt }],
  };
  if (OPENAI_MODEL.includes('gpt-')) {
    body.max_tokens = 1000;
    body.temperature = 0;
  } else {
    body.max_completion_tokens = 3000;
  }
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
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
// Uses AI-based log parsing
// -------------------------------------------------------------------------------------
async function extractFullErrorMessages(logs) {
  try {
    return processLogsWithOpenAI(logs);
  } catch (err) {
    console.error('❌ Failed to extract errors from logs:', err.message);
    return [];
  }
}

// -------------------------------------------------------------------------------------
// Analyze and fix errors using the new AI-based extractFullErrorMessages
// -------------------------------------------------------------------------------------
async function analyzeAndFixErrors(logs, attempt) {
  let fixedAnyFile = false;

  const errorLines = await extractFullErrorMessages(logs);
  console.log({ errorLines });

  for (const errorLine of errorLines) {
    const filePath = errorLine.filePath;
    const fullPath = path.resolve(filePath);

    if (fs.existsSync(fullPath)) {
      try {
        const fileContent = fs.readFileSync(fullPath, 'utf8');
        const prompt = getTaskPrompt(
          FIX_ERROR,
          fileContent,
          attempt - 1,
          errorLine.errorDescription,
          previosFixIntentsByFile[filePath] || []
        );

        const result = await processFileWithOpenAI(prompt, filePath);

        if (!previosFixIntentsByFile[filePath]) {
          previosFixIntentsByFile[filePath] = [];
        }
        previosFixIntentsByFile[filePath].push(result.fixExplanation);

        fs.writeFileSync(fullPath, result.updatedCode, 'utf8');
        console.log(`✅ Fixed ${filePath}`);
        fixedAnyFile = true;

        if (VERBOSE) {
          console.log(`ℹ️ ${result.fixExplanation || 'Fix applied successfully.'}\n`);
        }
      } catch (err) {
        console.error(`❌ Failed to process ${filePath}: ${err.message}`);
      }
    }
  }

  return fixedAnyFile;
}

// -------------------------------------------------------------------------------------
// Build attempts
// -------------------------------------------------------------------------------------
async function checkProjectHealth() {
  console.log('🚀 Starting project build...');
  let attempt = 1;

  while (attempt <= MAX_BUILD_ATTEMPTS) {
    try {
      console.log(`🔄 Attempt ${attempt} to build the project...`);
      execSync(`${PACKAGE_MANAGER} run build`, { stdio: 'pipe' });
      console.log('✅ Build succeeded!');
      return true;
    } catch (error) {
      console.error(`❌ Build failed on attempt ${attempt}. Parsing errors: ${error.message}`);
      const logs = error.stderr.toString();
      const fixed = await analyzeAndFixErrors(logs, attempt);

      if (!fixed) {
        console.error('⚠️ Errors could not be fixed. Halting further attempts.');
        return false;
      }

      attempt++;
    }
  }

  console.error('❌ Project build failed after maximum attempts.');
  return false;
}

// -------------------------------------------------------------------------------------
// Main "run" function that orchestrates everything
// -------------------------------------------------------------------------------------
(async function main() {
  try {
    if (VERBOSE) {
      console.log('Parsing arguments and starting i18n setup script...');
    }

    // If we are NOT build-only, proceed with normal i18n setup steps
    if (!BUILD_ONLY) {
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

      // 3) Create public/locales
      stepCreateLocalesFolder();

      // 4) i18n Refactor & translations
      const directoriesToScan = [];
      if (pagesDir && fs.existsSync(pagesDir)) {
        directoriesToScan.push(pagesDir);
      }
      if (componentsDir && fs.existsSync(componentsDir)) {
        directoriesToScan.push(componentsDir);
      }

      const eligibleFiles = await runRefactorAndTranslations(directoriesToScan);

      if (!!eligibleFiles && eligibleFiles.length > 0) {
        // Actually send files to OpenAI for i18n refactoring
        console.log(`🚀 Sending files (${eligibleFiles.length}) to OpenAI in parallel...`);
        await processFiles(eligibleFiles);
        console.log('🎉 Finished i18n refactoring!');
      } else {
        console.log('\nℹ️No changes made to the project (no i18n refactoring needed).');
      }

      // 5) Auto-translate
      console.log('🔤 Auto-translating from default locale to others...');
      await autoTranslateCommonJson();
      console.log('🎉 Done with auto-translation step!');

      // 6) Create LanguagePicker
      if (componentsDir) {
        stepCreateLanguagePicker(componentsDir);
      }

      // 7) Install next-intl
      stepInstallDependencies();
      console.log('✅ next-intl installation complete.');
    }

    // 8) Build step
    await checkProjectHealth();

    console.log('\n🎉 Done!');
  } catch (error) {
    console.trace(error);
    process.exit(1);
  }
})();



TODO:
- Create: 
// next-intl.config.js
module.exports = {
  locales: ['en', 'es', 'fr'], // Add your supported locales here
  defaultLocale: 'en',
  pages: {
    '*': ['common'], // Specify namespaces if using multiple
  },
};


- Update:
// next.config.js
const withNextIntl = require('next-intl/plugin')();

module.exports = withNextIntl({
  // Your existing Next.js configuration options
  reactStrictMode: true,
  // Add any other configurations you need
});

3. Update Your RootLayout Component
Your RootLayout should correctly wrap the application with NextIntlProvider and handle translations without using React hooks outside of components.


This is how I defined the todo list above:
he export errors you're encountering are primarily due to misconfigurations introduced while integrating internationalization (i18n) using the next-intl package. By ensuring that:

next-intl is correctly configured with the necessary configuration files.
Translation files are properly organized and accessible during both build and runtime.
Metadata generation correctly handles translations without relying on React hooks.
Environment variables are correctly set and accessed.
You can resolve these export errors and ensure a smooth build process. Additionally, adopting best practices like error boundaries, static analysis tools, and thorough documentation will bolster the robustness and maintainability of your project.

If you continue to face issues after implementing these solutions, consider providing more detailed build logs or specific error messages related to each failed path for further assistance.


Please, update the script to be prepare for this needs processing the needed file with AI? What do you think?

create file:
import createRequest from 'next-intl/request';

export default createRequest({
  getTranslations: async (locale, namespace) => {
    // Load translations dynamically (e.g., from a file or API)
    const messages = await import(`./locales/${locale}/${namespace}.json`);
    return messages.default;
  },
  locales: ['en', 'es'], // Supported locales
  defaultLocale: 'en',   // Default locale
});


Create the Request Configuration File:

Add the request.ts file in the expected location, e.g., src/i18n/request.ts. If you don't use a src directory, create it in the root i18n/request.ts.

File: src/i18n/request.ts

typescript
Copy
Edit
import createRequest from 'next-intl/request';

export default createRequest({
  getTranslations: async (locale, namespace) => {
    // Load translations dynamically (e.g., from a file or API)
    const messages = await import(`./locales/${locale}/${namespace}.json`);
    return messages.default;
  },
  locales: ['en', 'es'], // Supported locales
  defaultLocale: 'en',   // Default locale
});
Ensure Your Translations Exist:

Create a locales directory to store your JSON files for translations:

css
Copy
Edit
app/
├── i18n/
│   ├── request.ts
│   ├── locales/
│       ├── en/
│       │   ├── common.json
│       ├── es/
│           ├── common.json
Example common.json:

json
Copy
Edit
{
  "welcome": "Welcome!",
  "hello": "Hello, world!"
}
Specify a Custom Path in next.config.js (Optional):

If you want to use a custom file path or name, update your next.config.js like this:

javascript
Copy
Edit
const createNextIntlPlugin = require('next-intl/plugin');

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

module.exports = withNextIntl({
  reactStrictMode: true,
});

