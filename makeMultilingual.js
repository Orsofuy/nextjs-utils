#!/usr/bin/env node

/**
 * setup-i18n.js
 *
 * Adds i18n to Next.js using next-intl (without i18n routing).
 * 
 * This script performs the following actions:
 *
 *  A. Create or update next-intl.config.js using supported locales computed
 *     from DEFAULT_LOCALE and DEFAULT_ADDITIONAL_LOCALES.
 *
 *  B. (Documentation Only) Leaves next.config.js untouched (no URL‑based locale).
 *
 *  C. Create or update the i18n request configuration file (request.ts) so that translations
 *     are loaded from your LOCALE_FOLDER (which is now "messages").
 *
 *  D. Create or update the translation folder (in "messages") with example common.json files.
 *
 *  E. Patch your RootLayout (in the app folder) via AI so that it wraps children with
 *     NextIntlClientProvider.
 *
 *  F. Optionally run AI‑based i18n refactoring/auto‑translation on your pages/components.
 *
 *  G. Create a LanguagePicker component in your components directory.
 *
 *  H. Optionally run a build check.
 *
 * IMPORTANT:
 *   - next-intl.config.js will be generated as:
 *
 *         module.exports = {
 *           locales: [SUPPORTED_LOCALES],
 *           defaultLocale: '<DEFAULT_LOCALE>',
 *           pages: { '*': ['common'] }
 *         };
 *
 *   - The request.ts file (using getRequestConfig from next-intl/server) will be created in src/i18n (if exists)
 *     or in i18n/ otherwise.
 *
 *   - The translation folder will be created as "messages" with a common.json per locale.
 *
 *   - The RootLayout (in app/) will be patched via AI so that it imports and wraps children with NextIntlClientProvider.
 *
 *   - A basic LanguagePicker component will be created.
 *
 *   - In the AI prompt for refactoring, only user-facing strings are targeted (developer-only strings like those in console.log() are skipped).
 *
 * Usage: node setup-i18n.js [options]
 *
 * Options:
 *   -y, --yes             Run unattended (accept defaults)
 *   -h, --help            Show help message
 *   -m, --model           Specify OpenAI model (default: gpt-4o-mini)
 *   -c, --concurrency     Max concurrent OpenAI requests (default: 30)
 *   -l, --locale          Default locale (default: es)
 *   -a, --locales         Comma-separated additional locales (default: en,fr,de,zh,ar,pt,ru,ja)
 *   -f, --folder          Locale folder path (default: messages)
 *   -p, --package-manager Which package manager to use (yarn|npm|pnpm) (default: yarn)
 *   -v, --verbose         Enable verbose mode
 *   --dry-run             Only calculate token usage & cost; skip OpenAI calls
 *   --pages-dir           Manually specify your Next.js pages/app directory
 *   --components-dir      Manually specify your Next.js components directory
 *   -b, --build-only      Skip i18n setup steps & jump to build checks
 *
 * Environment variable:
 *   OPENAI_API_KEY  Your OpenAI API key must be set.
 *
 * NOTE: next.config.js is NOT updated by this script.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

let fetch; // Dynamically imported if needed

// -------------------------------------------------------------------------------------
// Default / Reference Config
// -------------------------------------------------------------------------------------
const DEFAULTS = {
  OPENAI_MODEL: 'gpt-4o-mini',
  MAX_CONCURRENT_REQUESTS: 30,
  DEFAULT_LOCALE: 'es',
  DEFAULT_ADDITIONAL_LOCALES: 'en,fr,de,zh,ar,pt,ru,ja',
  LOCALE_FOLDER: 'messages', // Using "messages" per App Router setup without i18n routing
  PACKAGE_MANAGER: 'yarn',
};

const PAGES_CANDIDATES = ['pages', 'src/pages', 'app', 'src/app'];
const COMPONENTS_CANDIDATES = ['components', 'src/components'];

const COST_PER_1K_TOKENS = {
  input: { 'gpt-4o': 0.0025, 'gpt-4o-mini': 0.00015, 'gpt-4': 0.03 },
  output: { 'gpt-4o': 0.01, 'gpt-4o-mini': 0.0006, 'gpt-4': 0.06 },
};

const TASK = {
  REFACTOR: 'REFACTOR',
  FIX_ERROR: 'FIX_ERROR',
  EXTRACT_ERRORS: 'EXTRACT_ERRORS'
};

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

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

// Compute supported locales (will be updated interactively if not unattended)
let SUPPORTED_LOCALES = [
  DEFAULT_LOCALE,
  ...ADDITIONAL_LOCALES.split(',').map(l => l.trim()).filter(Boolean)
];

// -------------------------------------------------------------------------------------
// Argument Parsing
// -------------------------------------------------------------------------------------
function printHelp() {
  console.log(`
Usage: ${path.basename(process.argv[1])} [options]

Options:
  -y, --yes             Run unattended (accept defaults)
  -h, --help            Show this help message
  -m, --model           Specify OpenAI model (default: ${DEFAULTS.OPENAI_MODEL})
  -c, --concurrency     Max concurrent OpenAI requests (default: ${DEFAULTS.MAX_CONCURRENT_REQUESTS})
  -l, --locale          Default locale (default: ${DEFAULTS.DEFAULT_LOCALE})
  -a, --locales         Comma-separated additional locales (default: ${DEFAULTS.DEFAULT_ADDITIONAL_LOCALES})
  -f, --folder          Locale folder path (default: ${DEFAULTS.LOCALE_FOLDER})
  -p, --package-manager Which package manager to use (yarn|npm|pnpm) (default: ${DEFAULTS.PACKAGE_MANAGER})
  -v, --verbose         Enable verbose mode
  --dry-run             Only calculate token usage & cost; skip OpenAI calls
  --pages-dir           Manually specify your Next.js pages/app directory
  --components-dir      Manually specify your Next.js components directory
  -b, --build-only      Skip i18n setup steps & jump to build checks

Environment variable:
  OPENAI_API_KEY  Your OpenAI API key must be set.
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
// Basic Prompt Helper
// -------------------------------------------------------------------------------------
async function promptUser(question, defaultValue) {
  if (UNATTENDED) return defaultValue;
  process.stdout.write(`${question} [Default: ${defaultValue}]: `);
  return new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.once('data', (data) => {
      process.stdin.pause();
      resolve(data.trim() || defaultValue);
    });
  });
}

// -------------------------------------------------------------------------------------
// Interactive Locale Configuration
// -------------------------------------------------------------------------------------
async function stepPromptForLocales() {
  DEFAULT_LOCALE = await promptUser("Enter your default locale (e.g., 'es')", DEFAULT_LOCALE);
  console.log(`Default locale set to: ${DEFAULT_LOCALE}`);
  const additional = await promptUser("Specify additional locales as comma-separated (e.g., 'en,fr,de')", ADDITIONAL_LOCALES);
  ADDITIONAL_LOCALES = additional;
  console.log(`Additional locales set to: ${ADDITIONAL_LOCALES}`);
}

function getAllLocales() {
  const splitted = ADDITIONAL_LOCALES.split(',');
  const trimmed = splitted.map((loc) => loc.trim()).filter(Boolean);
  return [DEFAULT_LOCALE, ...trimmed];
}

// -------------------------------------------------------------------------------------
// Step A: Create next-intl.config.js File
// -------------------------------------------------------------------------------------
function stepCreateNextIntlConfigFile() {
  const configPath = path.resolve('next-intl.config.js');
  const configContent = `module.exports = {
  locales: ${JSON.stringify(getAllLocales())},
  defaultLocale: '${DEFAULT_LOCALE}',
  pages: { '*': ['common'] },
};
`;
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, configContent, 'utf8');
    console.log(`✅ Created next-intl.config.js`);
  } else {
    console.log(`ℹ️ next-intl.config.js already exists. Skipping creation.`);
  }
}

// -------------------------------------------------------------------------------------
// Step B: (Documentation Only) Skip Updating next.config.js
// -------------------------------------------------------------------------------------
console.log('ℹ️ Skipping next.config.js update (using no URL path i18n).');

// -------------------------------------------------------------------------------------
// Step C: Create or Update the Request Configuration File (request.ts)
// -------------------------------------------------------------------------------------
function stepCreateOrUpdateRequestTs() {
  let baseFolder;
  if (fs.existsSync(path.resolve('src'))) {
    baseFolder = path.resolve('src/i18n');
    // Create request.ts using NextIntl’s getRequestConfig
    const requestTsPath = path.join(baseFolder, 'request.ts');
    const content = `
import { getRequestConfig } from 'next-intl/server';

export default getRequestConfig(async () => {
  // Here you can provide dynamic locale selection (e.g., via cookies)
  const locale = '${DEFAULT_LOCALE}';
  return {
    locale,
    messages: (await import(\`../../messages/\${locale}.json\`)).default
  };
});
`.trim();
    if (!fs.existsSync(requestTsPath)) {
      if (!fs.existsSync(baseFolder)) {
        fs.mkdirSync(baseFolder, { recursive: true });
      }
      fs.writeFileSync(requestTsPath, content, 'utf8');
      console.log(`✅ Created request.ts at ${requestTsPath}`);
    } else {
      console.log(`ℹ️ request.ts already exists at ${requestTsPath}. Skipping creation.`);
    }
  } else {
    // No src folder – create in i18n folder at root
    baseFolder = path.resolve('i18n');
    if (!fs.existsSync(baseFolder)) {
      fs.mkdirSync(baseFolder, { recursive: true });
      console.log(`✅ Created i18n folder at ${baseFolder}`);
    }
    const requestTsPath = path.join(baseFolder, 'request.ts');
    const content = `
import { getRequestConfig } from 'next-intl/server';

export default getRequestConfig(async () => {
  const locale = '${DEFAULT_LOCALE}';
  return {
    locale,
    messages: (await import(\`../messages/\${locale}.json\`)).default
  };
});
`.trim();
    if (!fs.existsSync(requestTsPath)) {
      fs.writeFileSync(requestTsPath, content, 'utf8');
      console.log(`✅ Created request.ts at ${requestTsPath}`);
    } else {
      console.log(`ℹ️ request.ts already exists at ${requestTsPath}. Skipping creation.`);
    }
  }
}

// -------------------------------------------------------------------------------------
// Step D: Create/Update Translation Folder Structure with Example Translations
// -------------------------------------------------------------------------------------
function stepCreateLocalesFolder() {
  const allLocales = getAllLocales();
  console.log('📁 Creating/updating translation folder structure...');
  // Create the "messages" folder at the project root
  if (!fs.existsSync(LOCALE_FOLDER)) {
    fs.mkdirSync(LOCALE_FOLDER, { recursive: true });
    console.log(`Created folder: ${LOCALE_FOLDER}`);
  }
  allLocales.forEach((locale) => {
    const localeDir = path.join(LOCALE_FOLDER, locale);
    if (!fs.existsSync(localeDir)) {
      fs.mkdirSync(localeDir, { recursive: true });
      console.log(`Created folder: ${localeDir}`);
    }
    const commonJson = path.join(localeDir, 'common.json');
    if (!fs.existsSync(commonJson)) {
      // Create an example file – you can adjust the content as needed
      fs.writeFileSync(commonJson, '{}', 'utf8');
      console.log(`Created '${commonJson}'`);
    }
  });
}

// -------------------------------------------------------------------------------------
// Step E: Patch RootLayout to Wrap with NextIntlClientProvider
// -------------------------------------------------------------------------------------
async function stepInjectNextIntlProviderInRootLayout() {
  const rootLayoutPath = findRootLayout();
  if (!rootLayoutPath) {
    console.log('ℹ️ No RootLayout found in "app" folder. Skipping NextIntlClientProvider injection...');
    return;
  }
  console.log(`📝 Checking RootLayout: ${rootLayoutPath}`);
  const fileContent = fs.readFileSync(rootLayoutPath, 'utf8');
  if (fileContent.includes('NextIntlClientProvider')) {
    console.log(`✅ NextIntlClientProvider already present in RootLayout. Skipping injection.`);
    return;
  }
  if (DRY_RUN) {
    console.log(`💡 [DRY-RUN] Would inject NextIntlClientProvider into ${rootLayoutPath}`);
    return;
  }
  console.log(`⚙️ NextIntlClientProvider not found. Using AI to patch RootLayout...`);
  const systemPrompt = getTaskPromptForRootLayout();
  const result = await processFileWithOpenAI(systemPrompt, rootLayoutPath);
  if (result && result.needsUpdate && result.updatedCode) {
    fs.writeFileSync(rootLayoutPath, result.updatedCode, 'utf8');
    console.log(`✅ Updated RootLayout with NextIntlClientProvider.`);
  } else {
    console.log('ℹ️ No changes made to RootLayout.');
  }
}

function findRootLayout() {
  const appDir = path.resolve('app');
  if (!fs.existsSync(appDir) || !fs.lstatSync(appDir).isDirectory()) return null;
  const candidates = ['layout.js', 'layout.jsx', 'layout.ts', 'layout.tsx'];
  for (const candidate of candidates) {
    const fullPath = path.join(appDir, candidate);
    if (fs.existsSync(fullPath)) return fullPath;
  }
  return null;
}

function getTaskPromptForRootLayout() {
  return `
We have a Next.js 13 RootLayout file that is not configured for next-intl.
It should:
1. Import { NextIntlClientProvider } from 'next-intl' and { getMessages } from 'next-intl/server';
2. Retrieve the locale (e.g., via cookies/headers) and messages by calling await getMessages();
3. Return an HTML structure with <html lang="{locale}"> and wrap children with <NextIntlClientProvider locale={locale} messages={messages}>.
Return ONLY valid JSON with this structure:
{
  "needsUpdate": true|false,
  "updatedCode": "<entire updated layout code>"
}
`.trim();
}

// -------------------------------------------------------------------------------------
// Step F: AI-Based i18n Refactoring & Auto-Translation (Optional)
// -------------------------------------------------------------------------------------
function getEligibleFiles(dir) {
  let results = [];
  const ignoredDirs = ['node_modules', '.next', '.git', 'dist', 'build'];
  const validExtensions = ['.js', '.jsx', '.ts', '.tsx'];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && !ignoredDirs.includes(entry.name)) {
      results = results.concat(getEligibleFiles(fullPath));
    } else if (entry.isFile()) {
      const ext = path.extname(fullPath);
      if (validExtensions.includes(ext)) {
        const content = fs.readFileSync(fullPath, 'utf8');
        if (/<[a-zA-Z]/.test(content) && !content.includes('useTranslations') && !content.includes('t(["') && !content.includes("t('")) {
          results.push(fullPath);
        } else if (VERBOSE) {
          console.log(`- Skipping non-matching file: ${fullPath}`);
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
  if (!OPENAI_API_KEY) {
    console.error('❌ Error: OPENAI_API_KEY is not set.');
    return [];
  }
  let eligibleFiles = [];
  for (const dir of directoriesToScan) {
    if (dir && fs.existsSync(dir)) {
      eligibleFiles = eligibleFiles.concat(getEligibleFiles(dir));
    }
  }
  if (eligibleFiles.length === 0) {
    console.log('✅ No eligible files found for i18n refactoring. Skipping auto-translation...');
  } else {
    console.log(`Found ${eligibleFiles.length} file(s) to process with OpenAI...`);
    if (VERBOSE) console.log('Files to refactor:', eligibleFiles);
  }
  if (DRY_RUN) {
    await doApproximateCostCheck(eligibleFiles, true);
    return [];
  } else if (!UNATTENDED) {
    const proceed = await doApproximateCostCheck(eligibleFiles, false);
    if (!proceed) {
      console.log('Aborting per user choice. No OpenAI calls will be made.');
      return [];
    }
  }
  return eligibleFiles;
}

async function doApproximateCostCheck(eligibleFiles, isDryRunMode) {
  const approxTokensNeeded = estimateTokensForFiles(eligibleFiles);
  const inputRate = COST_PER_1K_TOKENS.input[OPENAI_MODEL] || 0.03;
  const outputRate = COST_PER_1K_TOKENS.output[OPENAI_MODEL] || 0.03;
  const approxInputCost = (approxTokensNeeded / 1000) * inputRate;
  const approxOutputCost = (approxTokensNeeded / 1000) * outputRate;
  console.log(`\n--- COST ESTIMATE ---`);
  console.log(`Files count: ${eligibleFiles.length}`);
  console.log(`Model: ${OPENAI_MODEL}`);
  console.log(`Approx. input tokens needed: ${approxTokensNeeded}`);
  console.log(`Estimated costs: input: ~$${approxInputCost.toFixed(4)}, output: ~$${approxOutputCost.toFixed(4)}, TOTAL: ~$${(approxInputCost + approxOutputCost).toFixed(4)}\n`);
  if (isDryRunMode) {
    console.log('Dry-run mode only. No calls made.');
    return false;
  }
  const answer = await promptUser('Do you want to proceed with these AI calls? (yes/no)', 'no');
  return /^y(es)?$/i.test(answer);
}

function estimateTokensForFiles(files) {
  let totalTokens = 0;
  for (const filePath of files) {
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const overhead = 500;
    const combinedContent = getTaskPrompt(TASK.REFACTOR, fileContent, 0);
    totalTokens += Math.ceil((combinedContent.length + overhead) / 4);
  }
  return totalTokens;
}

function mergeObjects(target, source) {
  for (const key in source) {
    if (source.hasOwnProperty(key)) {
      if (
        typeof source[key] === 'object' &&
        source[key] !== null &&
        !Array.isArray(source[key])
      ) {
        if (!target[key] || typeof target[key] !== 'object') {
          target[key] = {};
        }
        mergeObjects(target[key], source[key]);
      } else {
        target[key] = source[key];
      }
    }
  }
  return target;
}

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
          const prompt = getTaskPrompt(TASK.REFACTOR, fileContent, 0);
          const result = await processFileWithOpenAI(prompt, filePath);
          if (result.needsUpdate) {
            fs.writeFileSync(filePath, result.updatedCode, 'utf8');
            console.log(`✅ Updated file: ${filePath}`);
            mergeObjects(allNewKeys, result.locales);
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
  const baseFolder = fs.existsSync(path.resolve('src'))
    ? path.join(path.resolve('src/i18n'), LOCALE_FOLDER)
    : LOCALE_FOLDER;
  locales.forEach(locale => {
    const commonFilePath = path.join(baseFolder, locale, 'common.json');
    let currentTranslations = {};
    if (fs.existsSync(commonFilePath)) {
      currentTranslations = JSON.parse(fs.readFileSync(commonFilePath, 'utf8'));
    }
    const merged = { ...currentTranslations, ...newKeys };
    if (!fs.existsSync(path.dirname(commonFilePath))) {
      fs.mkdirSync(path.dirname(commonFilePath), { recursive: true });
    }
    fs.writeFileSync(commonFilePath, JSON.stringify(merged, null, 2), 'utf8');
    console.log(`✅ Updated: ${commonFilePath}`);
  });
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
  if (!gptMessage) throw new Error('No content returned from OpenAI.');
  let parsed;
  try {
    parsed = JSON.parse(gptMessage.trim());
  } catch (err) {
    if (retryCount < 2) {
      console.warn(`Retrying ${filePath} due to JSON parse error...`);
      const newPrompt = getTaskPrompt(TASK.REFACTOR, fs.readFileSync(filePath, 'utf8'), retryCount + 1, err.message);
      return processFileWithOpenAI(newPrompt, filePath, retryCount + 1);
    }
    throw new Error(`Failed to parse JSON: ${err.message}`);
  }

  if (parsed.needsUpdate) {
    parsed.updatedCode = sanitizeCode(parsed.updatedCode);
    const { valid, errorMsg } = validateUpdatedCode(parsed);
    if (!valid) {
      console.log(errorMsg)
      if (retryCount < 2) {
        console.warn(`Retrying ${filePath} due to validation issues...`);
        const newPrompt = getTaskPrompt(TASK.REFACTOR, fs.readFileSync(filePath, 'utf8'), retryCount + 1, errorMsg);
        return processFileWithOpenAI(newPrompt, filePath, retryCount + 1);
      }
      throw new Error('Validation failed for updated code after retries.');
    }
  }
  return parsed;
}

async function processLogsWithOpenAI(logs, retryCount = 0) {
  if (!fetch) {
    const { default: f } = await import('node-fetch');
    fetch = f;
  }
  const promptText = getTaskPrompt(TASK.EXTRACT_ERRORS, logs, retryCount);
  const body = {
    model: OPENAI_MODEL,
    messages: [{ role: 'user', content: promptText }],
  };
  if (OPENAI_API_KEY === undefined) {
    throw new Error('OPENAI_API_KEY is not set.');
  }
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
  if (!gptMessage) throw new Error('No content returned from OpenAI for log extraction.');
  let parsed;
  try {
    parsed = JSON.parse(gptMessage.trim());
  } catch (err) {
    if (retryCount < 2) {
      console.warn(`Retrying logs extraction due to JSON parse error...`);
      return processLogsWithOpenAI(logs, retryCount + 1);
    }
    throw new Error(`Failed to parse JSON: ${err.message}`);
  }
  if (!parsed.extractedErrors || !Array.isArray(parsed.extractedErrors))
    throw new Error('Missing or invalid "extractedErrors" in AI response.');
  return parsed.extractedErrors;
}

function getTaskPrompt(task, fileContent = '', retryCount = 0, compileErrors = '', previousFixIntents = []) {
  const taskPrompts = {
    REFACTOR: `You are a Next.js and i18n expert using the "next-intl" package.
Your goal is to internationalize the provided Next.js file by updating the code to use the t() method and retrieve the corresponding locales.json file.

Rules:

1. **String Extraction**
   - Find ALL user-facing strings. (Skip console or logging strings.)
   - This includes:
     - JSX text
     - aria-labels
     - alt texts
     - title attributes
     - placeholder attributes
     - template literals
     - (and any other attributes that might contain user-facing text)

2. **Key Management**
   - Sanitize keys: lowercase, underscores, no special characters.
   - Use format: [element]_[purpose] (e.g., "header_title", "cta_button").
   - **Never use dots** in keys.
   - Check the existing locale.json for this component to avoid duplicates.
     - If an exact string already exists, reuse the existing key.
     - If the existing key is different but still suitable, consider reusing it.
     - If the string is different enough to merit a new key, create one accordingly.

3. **Translation Structure**
   - Maintain a nested structure per component namespace.

4. **For Client Components**
   - Ensure the file imports { useTranslations } from 'next-intl'.
   - Define const t = useTranslations('ComponentName'); (e.g., 'UserProfile').

5. **Replace Literal Text**
   - Replace literal text with calls to t('<corresponding locales key>').

6. **Preserve All Code and Comments**
   - Keep the original code structure, spacing, and comments intact.

7. **Return ONLY Valid JSON**
   - The JSON must have the following structure:
       {
         "needsUpdate": true|false,
         "updatedCode": "<entire updated file (or empty if no changes)>",
         "locales": { <next-intl locales expected format> }
       }
     - If no changes are required, set "needsUpdate": false and "updatedCode" to "".
     - Don't wrap the code into \`\`\`json

Additional Notes on Server Components (If Applicable):
- If dealing with server components, clarify how you plan to load translations (e.g., using createTranslator or a similar pattern). If not relevant, you can omit changes for them.

---

Example:

Given this file:
import {useTranslations} from 'next-intl';
export default function UserProfile({user}) {
  const t = useTranslations('UserProfile');
  return (
    <section>
      <h1>{t('title', {firstName: user.firstName})}</h1>
      <p>{t('membership', {memberSince: user.memberSince})}</p>
      <p>{t('followers', {count: user.numFollowers})}</p>
    </section>
  );
}

And the translation file en.json:
{
  "UserProfile": {
    "title": "{firstName}'s profile",
    "membership": "Member since {memberSince, date, short}",
    "followers": "{count, plural, =0 {No followers yet} =1 {One follower} other {# followers}}"
  }
}

The rendered output might be:
<section>
  <h2>Jane's profile</h2>
  <p>Member since Oct 13, 2023</p>
  <p>1,481 followers</p>
</section>
`.trim(),
    FIX_ERROR: `
Fix the code causing the build error.
Current error: ${compileErrors}
Return ONLY valid JSON:
{
  "fixExplanation": "Explanation",
  "updatedCode": "<full updated code>"
}
`.trim(),
    EXTRACT_ERRORS: `
Extract errors from the provided build log.
Return a JSON object:
{
  "extractedErrors": [
    { "filePath": "path", "errorType": "Error category", "errorDescription": "Full error message" },
    ...
  ]
}
`.trim()
  };
  if (!taskPrompts[task]) {
    throw new Error('Invalid TASK identifier.');
  }
  let prompt = taskPrompts[task];
  if (fileContent) {
    prompt += `

File content:
${fileContent}
`;
  }
  if (previousFixIntents.length > 0) {
    prompt += `

Previous fix attempts:
${previousFixIntents.join('\n')}
`;
  }
  if (retryCount > 0) {
    prompt = `IMPORTANT: The previous attempt failed. Ensure your response strictly follows the JSON structure.\n\n${prompt}`;
  }
  return prompt;
}

function sanitizeCode(output) {
  let sanitized = output.replace(/^\s*```[a-zA-Z]*\s*|\s*```$/g, '');
  return sanitized.endsWith('\n') ? sanitized : sanitized + '\n';
}

/** get all t() usage from code so to check against the autogenerated locales */
function extractUsedKeys(code) {
  const nameSpacePattern = /t = [^\(]*\(["']([^"']+)\1\)/g;
  const nameSpaceMatch = nameSpacePattern.exec(code);

  const pattern = /t\((["'])([^"']+)\1\)/g;
  const usedKeys = new Set();
  let match;
  while ((match = pattern.exec(code)) !== null) {
    usedKeys.add(`${nameSpaceMatch[2]}.${match[2]}`);
  }
  return usedKeys;
}

/**
 * Recursively traverses the locales object to collect all keys.
 * Example:
 *  {
 *    "UserProfile": {
 *      "title": "some text",
 *      "nested": {"subtitle": "another text"}
 *    }
 *  }
 *  becomes -> ["UserProfile.title", "UserProfile.nested.subtitle"]
 *
 * If you don't want dots in keys, you can choose to store them in
 * a non-dotted format or do direct lookups.
 */
function collectLocaleKeys(locales, prefix = '') {
  const keys = [];
  for (const key in locales) {
    const val = locales[key];
    const newPrefix = prefix ? `${prefix}.${key}` : key;
    if (val && typeof val === 'object') {
      keys.push(...collectLocaleKeys(val, newPrefix));
    } else {
      keys.push(newPrefix);
    }
  }
  return keys;
}

function validateUpdatedCode(aiResult) {
  const { updatedCode, locales } = aiResult;
  
  if (!updatedCode || !updatedCode.trim()) {
    const errorMsg = 'Validation failed: Updated code is empty.'
    return { valid: false, errorMsg };
  }

  // FIXME:
  // // 1. Extract the keys that the updated code is using
  // const usedKeys = extractUsedKeys(updatedCode);
  // console.log({usedKeys})
  
  // // 2. Flatten all keys from the locales object
  // const allLocaleKeys = collectLocaleKeys(locales);
  // const localeKeySet = new Set(allLocaleKeys);
  // console.log({localeKeySet})

  // // 3. Check that every used key is in the locales
  // for (const usedKey of usedKeys) {
  //   if (!localeKeySet.has(usedKey)) {
  //     const errorMsg = `Validation failed: Missing locale key => "${usedKey}"`;
  //     return { valid: false, errorMsg };
  //   }
  // }

  // // 4. (Optional) Warn about any keys in the locales that aren't used
  // const unusedLocaleKeys = allLocaleKeys.filter(k => !usedKeys.has(k));
  // if (unusedLocaleKeys.length > 0) {
  //   const errorMsg = `Warning: The following locale keys are not used in the code: ${unusedLocaleKeys}`;
  //   return { valid: false, errorMsg };
  // }

  return { valid: true };
}

// -------------------------------------------------------------------------------------
// Step G: Auto-translate default common.json to other locales
// -------------------------------------------------------------------------------------
async function autoTranslateCommonJson() {
  const allLocales = getAllLocales();
  const additionalLocales = allLocales.filter(loc => loc !== DEFAULT_LOCALE);
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
    await Promise.all(batch.map(locale => translateLocale(locale)));
  }
  for (const locale of additionalLocales) {
    const localeCommonPath = path.join(LOCALE_FOLDER, locale, 'common.json');
    let existing = {};
    if (fs.existsSync(localeCommonPath)) {
      existing = JSON.parse(fs.readFileSync(localeCommonPath, 'utf8'));
    }
    const merged = { ...existing, ...translationsPerLocale[locale] };
    if (!fs.existsSync(path.dirname(localeCommonPath))) {
      fs.mkdirSync(path.dirname(localeCommonPath), { recursive: true });
    }
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
"${text}"
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


async function analyzeAndFixErrors(logs, attempt) {
  let fixedAnyFile = false;
  const errorLines = await processLogsWithOpenAI(logs);
  console.log({ errorLines });
  for (const errorLine of errorLines) {
    const filePath = errorLine.filePath;
    const fullPath = path.resolve(filePath);
    if (fs.existsSync(fullPath)) {
      try {
        const fileContent = fs.readFileSync(fullPath, 'utf8');
        const prompt = getTaskPrompt(
          TASK.FIX_ERROR,
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
      } catch (err) {
        console.error(`❌ Failed to process ${filePath}: ${err.message}`);
      }
    }
  }
  return fixedAnyFile;
}

async function checkProjectHealth() {
  console.log('🚀 Starting project build...');
  let attempt = 1;
  const MAX_BUILD_ATTEMPTS = 5;
  while (attempt <= MAX_BUILD_ATTEMPTS) {
    try {
      console.log(`🔄 Attempt ${attempt} to build the project...`);
      execSync(`${PACKAGE_MANAGER} run build`, { stdio: 'pipe' });
      console.log('✅ Build succeeded!');
      return true;
    } catch (error) {
      console.error(`❌ Build failed on attempt ${attempt}: ${error.message}`);
      const logs = error.stderr.toString();
      const fixed = await analyzeAndFixErrors(logs, attempt);
      if (!fixed) {
        console.error('⚠️ Errors could not be fixed automatically. Halting further attempts.');
        return false;
      }
      attempt++;
    }
  }
  console.error('❌ Project build failed after maximum attempts.');
  return false;
}

// -------------------------------------------------------------------------------------
// Main Orchestration
// -------------------------------------------------------------------------------------
(async function main() {
  try {
    if (VERBOSE) {
      console.log('Starting i18n setup with arguments:', {
        UNATTENDED,
        OPENAI_MODEL,
        DRY_RUN,
        BUILD_ONLY
      });
    }
    if (!BUILD_ONLY) {
      // Step 1: Prompt for locales (if interactive)
      if (!UNATTENDED) {
        await stepPromptForLocales();
      } else {
        console.log(`Running unattended with default locale=${DEFAULT_LOCALE} and additional locales=${ADDITIONAL_LOCALES}`);
      }
      const projectDir = process.cwd();
      if (!isNextProject(projectDir)) {
        throw new Error('❌ No Next.js project detected!');
      }
      const { pagesDir, componentsDir } = await detectOrPromptPagesComponentsDir(projectDir);

      // Step 2: Create next-intl.config.js file
      stepCreateNextIntlConfigFile();

      // Step 3: (Documentation Only) Skip updating next.config.js
      console.log('ℹ️ Skipping next.config.js update (using no URL path i18n).');

      // Step 4: Create translation folder structure ("messages")
      stepCreateLocalesFolder();

      // Step 5: Create or update request.ts configuration file
      stepCreateOrUpdateRequestTs();

      // Step 6: Run AI-based i18n refactoring on eligible files
      const directoriesToScan = [];
      if (pagesDir && fs.existsSync(pagesDir)) directoriesToScan.push(pagesDir);
      if (componentsDir && fs.existsSync(componentsDir)) directoriesToScan.push(componentsDir);
      const eligibleFiles = await runRefactorAndTranslations(directoriesToScan);
      if (eligibleFiles && eligibleFiles.length > 0) {
        console.log(`🚀 Sending ${eligibleFiles.length} file(s) to OpenAI for i18n refactoring...`);
        await processFiles(eligibleFiles);
        console.log('🎉 Finished i18n refactoring!');
      } else {
        console.log('ℹ️ No eligible files for refactoring.');
      }

      // Step 7: Auto-translate common.json from default locale to others
      console.log('🔤 Auto-translating from default locale to others...');
      await autoTranslateCommonJson();
      console.log('🎉 Auto-translation complete!');

      // Step 8: Create LanguagePicker component (if components directory exists)
      if (componentsDir) {
        stepCreateLanguagePicker(componentsDir);
      }

      // Step 9: Install next-intl dependency
      stepInstallDependencies();
      console.log('✅ next-intl installation complete.');
    }
    // Step 10: Build check
    const buildSuccess = await checkProjectHealth();
    if (!buildSuccess) process.exit(1);
    console.log('\n🎉 All steps completed successfully!');
  } catch (error) {
    console.trace(error);
    process.exit(1);
  }
})();


// -------------------------------------------------------------------------------------
// Helper Functions
// -------------------------------------------------------------------------------------
async function detectOrPromptPagesComponentsDir(projectDir) {
  if (PAGES_DIR_OVERRIDE && COMPONENTS_DIR_OVERRIDE) {
    const verifiedPages = await verifyDirectory(PAGES_DIR_OVERRIDE, 'pages/app');
    const verifiedComponents = await verifyDirectory(COMPONENTS_DIR_OVERRIDE, 'components');
    return { pagesDir: verifiedPages, componentsDir: verifiedComponents };
  }
  if (PAGES_DIR_OVERRIDE && !COMPONENTS_DIR_OVERRIDE) {
    const verifiedPages = await verifyDirectory(PAGES_DIR_OVERRIDE, 'pages/app');
    const autoComponents = findFirstExistingCandidate(projectDir, COMPONENTS_CANDIDATES);
    if (autoComponents) return { pagesDir: verifiedPages, componentsDir: autoComponents };
    const finalComponents = await promptDirectoryIfNeeded('components directory', COMPONENTS_CANDIDATES);
    return { pagesDir: verifiedPages, componentsDir: finalComponents };
  }
  if (!PAGES_DIR_OVERRIDE && COMPONENTS_DIR_OVERRIDE) {
    const verifiedComponents = await verifyDirectory(COMPONENTS_DIR_OVERRIDE, 'components');
    const autoPages = findFirstExistingCandidate(projectDir, PAGES_CANDIDATES);
    if (autoPages) return { pagesDir: autoPages, componentsDir: verifiedComponents };
    const finalPages = await promptDirectoryIfNeeded('pages/app directory', PAGES_CANDIDATES);
    return { pagesDir: finalPages, componentsDir: verifiedComponents };
  }
  return await detectNextAppAndComponents(projectDir);
}

async function verifyDirectory(dirPath, label) {
  const fullPath = path.resolve(dirPath);
  if (fs.existsSync(fullPath) && fs.lstatSync(fullPath).isDirectory()) {
    return fullPath;
  }
  if (UNATTENDED) {
    throw new Error(`❌ The specified ${label} directory "${dirPath}" does not exist.`);
  } else {
    console.log(`❌ The specified ${label} directory "${dirPath}" is invalid. Please provide a valid path.`);
    return promptDirectory(label, fullPath);
  }
}

async function promptDirectoryIfNeeded(label, candidates) {
  const projectDir = process.cwd();
  const found = findFirstExistingCandidate(projectDir, candidates);
  if (found) return found;
  return promptDirectory(label);
}

async function promptDirectory(label, defaultValue = '.') {
  let result;
  while (!result) {
    const answer = await promptUser(`Enter a valid path for your ${label} (relative or absolute)`, defaultValue);
    const absPath = path.resolve(answer);
    if (fs.existsSync(absPath) && fs.lstatSync(absPath).isDirectory()) {
      result = absPath;
    } else {
      console.log(`❌ Directory "${answer}" not found. Please try again.`);
    }
  }
  return result;
}

async function detectNextAppAndComponents(projectDir) {
  if (!isNextProject(projectDir)) {
    throw new Error('❌ No Next.js project detected!');
  }
  const appDir = findFirstExistingCandidate(projectDir, PAGES_CANDIDATES);
  const componentsDir = findFirstExistingCandidate(projectDir, COMPONENTS_CANDIDATES);
  if (!appDir && !componentsDir) {
    throw new Error('❌ Could not find any "pages/app" or "components" directory.');
  }
  return { pagesDir: appDir, componentsDir };
}

function isNextProject(projectDir) {
  const packageJsonPath = path.join(projectDir, 'package.json');
  let foundNext = false;
  if (fs.existsSync(packageJsonPath)) {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
    foundNext = Boolean(deps && deps.next);
  }
  const nextConfigPath = path.join(projectDir, 'next.config.js');
  return foundNext || fs.existsSync(nextConfigPath);
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

function stepCreateLanguagePicker(componentsDir) {
  const allLocales = getAllLocales();
  console.log('🛠 Creating LanguagePicker component...');
  if (!componentsDir) {
    console.log('⚠️ No components directory found. Skipping LanguagePicker creation.');
    return;
  }
  if (!fs.existsSync(componentsDir)) {
    fs.mkdirSync(componentsDir, { recursive: true });
    console.log(`Created components directory: ${componentsDir}`);
  }
  const jsArray = `[${allLocales.map(l => `"${l}"`).join(', ')}]`;
  const pickerPath = path.join(componentsDir, 'LanguagePicker.tsx');
  const content = `
'use client';

import React from 'react';
import {createNavigation} from 'next-intl/navigation';

// 1. Define the locales & config
const {Link, useRouter, usePathname, redirect} = createNavigation({
  // The locales your app supports
  locales: ["es", "en", "fr", "de", "zh", "ar", "pt", "ru", "ja"],
  // The default locale (optional)
  defaultLocale: 'es',
  // (Optional) For custom routing logic, provide getPathname:
  // getPathname({locale, defaultLocale, pathname}) {
  //   // For example, prefix non-default locales
  //   if (locale && locale !== defaultLocale) {
  //     return \`/${locale}${pathname}\`;
  //   }
  //   return pathname;
  // }
});

// 2. Client usage (Link, useRouter, usePathname)
export default function AllInOneDemo() {
  const router = useRouter();
  const pathname = usePathname();

  function handleClientNav() {
    // Navigates client-side to /some-other-path
    router.push('/some-other-path');
  }

  return (
    <main style={{padding: '1rem'}}>
      <h1>All-in-One Navigation Demo</h1>
      <p>Current path: <strong>{pathname}</strong></p>

      <nav style={{marginBottom: '1rem'}}>
        <Link href="/" locale="en" style={{marginRight: '8px'}}>
          English
        </Link>
        <Link href="/" locale="de">
          German
        </Link>
      </nav>

      <button onClick={handleClientNav}>Go to /some-other-path (client-side)</button>
    </main>
  );
}

// -----------------------------
// 3. (Optional) Server usage
//    If you need server redirects, you'd do so in a server component or action:
// -----------------------------

// export async function MyServerAction() {
//   // This must live in a server file (no 'use client')
//   // redirect('/some-server-side-redirect');
// }
`.trim();
  fs.writeFileSync(pickerPath, content, 'utf8');
  console.log(`✅ Created LanguagePicker.tsx in '${componentsDir}'`);
}
