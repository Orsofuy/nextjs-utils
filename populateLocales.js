#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

let fetch; // Dynamically imported if needed

// Configuration
const DEFAULTS = {
    LOCALE_FOLDER: 'messages',
    OPENAI_MODEL: 'gpt-4o-mini',
    MAX_CONCURRENT_REQUESTS: 5,
    SUPPORTED_LOCALES: [],
    REFERENCE_LOCALE: undefined
};

let VERBOSE = false;
let DRY_RUN = false;

// -------------------------------------------------------------------------------------
// Argument Parsing
// -------------------------------------------------------------------------------------
function parseArgs() {
    const args = process.argv.slice(2);
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        switch (arg) {
            case '-h':
            case '--help':
                printHelp();
                process.exit(0);
            case '-f':
            case '--folder':
                LOCALE_FOLDER = args[i + 1];
                i++;
                break;
            case '-m':
            case '--model':
                OPENAI_MODEL = args[i + 1];
                i++;
                break;
            case '-v':
            case '--verbose':
                VERBOSE = true;
                break;
            case '--dry-run':
                DRY_RUN = true;
                break;
            default:
                console.error(`Unknown argument: ${arg}`);
                printHelp();
                process.exit(1);
        }
    }
}

function printHelp() {
    console.log(`
  Usage: ${path.basename(process.argv[1])} [options]
  
  Options:
    -h, --help          Show this help message
    -f, --folder        Locale folder path (default: ${DEFAULTS.LOCALE_FOLDER})
    -m, --model         OpenAI model (default: ${DEFAULTS.OPENAI_MODEL})
    -v, --verbose       Enable verbose mode
    --dry-run           Simulate translation without writing files
  
  Environment variable:
    OPENAI_API_KEY      Your OpenAI API key must be set
  `);
}

// -------------------------------------------------------------------------------------
// Config Loading
// -------------------------------------------------------------------------------------

function loadNextIntlConfig() {
    try {
        const configPath = path.resolve('next-intl.config.js');
        if (!fs.existsSync(configPath)) {
            throw new Error('Config file not found');
        }

        const config = require(configPath);
        if (!config.locales || !Array.isArray(config.locales)) {
            throw new Error('Invalid locales array in config');
        }

        return {
            locales: config.locales,
            defaultLocale: config.defaultLocale
        };
    } catch (error) {
        console.error('❌ Error loading next-intl.config.js:', error.message);
        process.exit(1);
    }
}

// -------------------------------------------------------------------------------------
// Core Logic Updates
// -------------------------------------------------------------------------------------

function findMissingKeys(reference, target) {
    const missing = {};

    function recurse(refObj, targObj, path = []) {
        for (const [key, value] of Object.entries(refObj)) {
            const currentPath = [...path, key];
            if (!targObj.hasOwnProperty(key)) {
                let current = missing;
                for (const p of path) current = current[p] = current[p] || {};
                current[key] = value;
            } else if (typeof value === 'object' && !Array.isArray(value)) {
                recurse(value, targObj[key], currentPath);
            }
        }
    }

    recurse(reference, target);
    return missing;
}

function deepMerge(target, source) {
    for (const [key, value] of Object.entries(source)) {
        if (typeof value === 'object' && !Array.isArray(value)) {
            target[key] = deepMerge(target[key] || {}, value);
        } else {
            target[key] = value;
        }
    }
    return target;
}

function flattenObject(obj, prefix = '') {
    let entries = [];
    for (const key in obj) {
        const value = obj[key];
        const currentPath = prefix ? `${prefix}.${key}` : key;
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            entries = entries.concat(flattenObject(value, currentPath));
        } else {
            entries.push({ path: currentPath, value });
        }
    }
    return entries;
}

function unflattenTranslations(translations) {
    const result = {};
    for (const { path: keyPath, translated } of translations) {
        const parts = keyPath.split('.');
        let current = result;
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            if (i === parts.length - 1) {
                current[part] = translated;
            } else {
                current[part] = current[part] || {};
                current = current[part];
            }
        }
    }
    return result;
}

async function processTranslationsConcurrently(items, targetLocale) {
    const queue = [...items];
    const results = [];
    const MAX_CONCURRENT = DEFAULTS.MAX_CONCURRENT_REQUESTS;

    async function worker() {
        while (queue.length > 0) {
            const item = queue.shift();
            if (!item) return;
            try {
                const translated = await translateWithAI(item.value, targetLocale);
                results.push({ path: item.path, translated });
                if (VERBOSE) {
                    console.log(`Translated ${item.path}: ${item.value} → ${translated}`);
                }
            } catch (error) {
                console.error(`Error translating path ${item.path}: ${error.message}`);
            }
        }
    }

    const workers = Array(MAX_CONCURRENT).fill().map(() => worker());
    await Promise.all(workers);
    return results;
}

async function translateMissingKeys() {
    const referencePath = path.join(DEFAULTS.LOCALE_FOLDER, DEFAULTS.REFERENCE_LOCALE, 'common.json');
    const referenceData = JSON.parse(fs.readFileSync(referencePath, 'utf8'));

    for (const locale of DEFAULTS.SUPPORTED_LOCALES) {
        if (locale === DEFAULTS.REFERENCE_LOCALE) continue;

        const targetPath = path.join(DEFAULTS.LOCALE_FOLDER, locale, 'common.json');
        if (!fs.existsSync(targetPath)) {
            console.log(`Skipping ${locale} - no common.json found`);
            continue;
        }

        const targetData = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
        const missing = findMissingKeys(referenceData, targetData);

        if (Object.keys(missing).length === 0) {
            console.log(`✅ ${locale}: No missing keys`);
            continue;
        }

        const flattened = flattenObject(missing);
        console.log(`🌐 ${locale}: Found ${flattened.length} missing keys`);

        if (DRY_RUN) {
            console.log('Dry run - would translate:', JSON.stringify(missing, null, 2));
            continue;
        }

        try {
            const translations = await processTranslationsConcurrently(flattened, locale);
            const translatedObject = unflattenTranslations(translations);
            const merged = deepMerge(targetData, translatedObject);

            fs.writeFileSync(targetPath,
                JSON.stringify(merged, null, 2) + '\n',
                'utf8'
            );
            console.log(`✅ ${locale}: Updated common.json with ${translations.length} translations`);
        } catch (error) {
            console.error(`❌ ${locale}: Error translating - ${error.message}`);
        }
    }
}

// -------------------------------------------------------------------------------------
// OpenAI Integration
// -------------------------------------------------------------------------------------

async function translateWithAI(text, targetLocale) {
    if (!fetch) {
        const { default: f } = await import('node-fetch');
        fetch = f;
    }

    const prompt = `Translate the following text from ${DEFAULTS.REFERENCE_LOCALE} to ${targetLocale}. 
Preserve any placeholders like {this} in the text. Keep the translation concise and accurate.
Respond only with the translated text without any explanations or formatting.

Text to translate: "${text}"`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
            model: DEFAULTS.OPENAI_MODEL,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.1,
            max_tokens: 2000
        })
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`API Error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    const translatedText = data.choices[0].message.content.trim();
    return translatedText.replace(/^"(.*)"$/, '$1'); // Remove surrounding quotes if present
}

// -------------------------------------------------------------------------------------
// Main Execution
// -------------------------------------------------------------------------------------
(async () => {
    try {
        parseArgs();

        // Load configuration from next-intl.config.js
        const { locales, defaultLocale } = loadNextIntlConfig();
        DEFAULTS.REFERENCE_LOCALE = defaultLocale;
        DEFAULTS.SUPPORTED_LOCALES = locales.filter(l => l !== DEFAULTS.REFERENCE_LOCALE);

        if (!DEFAULTS.SUPPORTED_LOCALES.length) {
            console.error('Error: No target locales found in config');
            process.exit(1);
        }

        if (!process.env.OPENAI_API_KEY) {
            console.error('Error: OPENAI_API_KEY environment variable required');
            process.exit(1);
        }

        console.log('🚀 Starting translation process...');
        console.log(`Reference locale: ${DEFAULTS.REFERENCE_LOCALE}`);
        console.log(`Target locales: ${DEFAULTS.SUPPORTED_LOCALES.join(', ')}`);

        await translateMissingKeys();

        console.log('🎉 Translation completed successfully');
    } catch (error) {
        console.error('❌ Fatal error:', error.message);
        process.exit(1);
    }
})();
