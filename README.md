# Next.js Automatic i18n Script

Make your Next.js app fully multilingual with a single script! This repository contains:

1. A Bash script (`i18n-setup.sh`) that bootstraps your Next.js app for **internationalization**.
2. A Node.js helper (`refactor-i18n.js`) that uses AI to refactor your code for i18n and populate `common.json` files with translations for each locale.

---

## Table of Contents

- [Key Features](#key-features)
- [Installation](#installation)
- [Usage](#usage)
- [Environment Variables](#environment-variables)
- [How It Works](#how-it-works)
  - [File Eligibility](#file-eligibility)
  - [Refactor Script](#refactor-script)
  - [Auto-Translation](#auto-translation)
- [Customization](#customization)
  - [Choice of Key Syntax for `common.json`](#choice-of-key-syntax-for-commonjson)
- [Contributing](#contributing)
- [TODOs and Future Improvements](#todos-and-future-improvements)
- [License](#license)

---

## Key Features

- **One-Stop Script**: Installs `next-i18next` dependencies and configures your `next.config.js` automatically.
- **AI Refactoring**: Uses ChatGPT (or other AI providers) to detect user-facing strings and replace them with `t("key")`.
- **No Redundant Keys**: The script only merges keys actually used in the code (`t("...")`) into your `common.json`.
- **Automatic Translations**: Translates default locale strings into additional languages using AI.
- **Skips Unchanged Files**: If no user-facing strings are found, the file remains untouched.

---

## Installation

To integrate this script into your Next.js project:

1. **Download and Execute** the script directly from the repository:
   ```bash
   wget https://<your-public-repo-link>/i18n-setup.sh -O i18n-setup.sh && chmod +x i18n-setup.sh && ./i18n-setup.sh
   ```

2. Follow the prompts to configure your default locale and additional locales.

3. Once complete, your Next.js app will be ready for multilingual support!

---

## Usage

1. Run the script:
   ```bash
   ./i18n-setup.sh
   ```
2. Follow the on-screen prompts to:
   - Set your default locale.
   - Add additional locales.
   - Automatically translate strings.

3. Start your development server to test the multilingual functionality:
   ```bash
   yarn dev
   ```

---

## Environment Variables

Ensure your environment includes the following:

- **OpenAI API Key**: Export it or include it in an `.env` file.
  ```bash
  export OPENAI_API_KEY=<your-api-key>
  ```
- **Optional Variables**:
  - `OPENAI_MODEL`: AI model to use (default: `gpt-4`).
  - `MAX_CONCURRENT_REQUESTS`: Maximum parallel requests to OpenAI (default: `20`).

---

## How It Works

### File Eligibility

The script scans your project for files that:
1. Contain user-facing strings.
2. Have JSX or HTML structures.
3. Don't already use `useTranslation` or `t(...)`.

### Refactor Script

The Node.js script:
1. Processes eligible files.
2. Replaces user-facing strings with `t("key")`.
3. Outputs changes to `common.json` files.

### Auto-Translation

The script translates default locale strings into additional locales using AI. Translations are merged into `common.json` for each locale.

---

## Customization

### Choice of Key Syntax for `common.json`

You can choose how keys are generated for translations:
1. **Use the same text as key**: `"Welcome to our app" -> "Welcome to our app": "Welcome to our app"`.
2. **Replace spaces with dashes**: `"Welcome to our app" -> "welcome-to-our-app": "Welcome to our app"`.
3. **Generate logical keys with AI**: `"Welcome to our app" -> "welcomeMessage": "Welcome to our app"`.

---

## Contributing

We welcome contributions! Feel free to:
- Open issues for bugs or feature requests.
- Submit pull requests to improve the script.

---

## TODOs and Future Improvements

### Planned Features

- **AI Provider Flexibility**:
  - Integrate offline AI models (e.g., [Llama2](https://huggingface.co/meta-llama/Llama-2)) to reduce API costs.
  - Support additional providers like Google Translate or DeepL.

- **Key Generation Options**:
  - Add CLI options to specify key-generation strategies (e.g., same text, dashed, AI-generated).

- **File Preview Before Update**:
  - Allow a dry-run mode to preview file changes without applying them.

- **Granular Translation Control**:
  - Add options to skip auto-translation for specific locales.

- **Enhanced Compatibility**:
  - Support more frameworks and libraries beyond `react-i18next`.

### Future Syntax Enhancements

- Define a structured key naming convention:
  - Grouped by components (e.g., `header.title`, `footer.contact`).
  - Customizable via project settings.

---

## License

This project is open source and available under the [MIT License](LICENSE).

