// ESLint flat config for the whole repo.
//
// Two "packages" get linted here: the root Phase 0 CLI pipeline
// (src/, tests/) and the web app (web/src/). They get separate
// blocks below because they run in different environments (Node vs
// browser) and only the web app uses React. The repository's own tools —
// scripts/, web/scripts/ and the browser tests in web/e2e/ — are Node
// code and take the first block's rules.
//
// This is meant as a safety net over code that already exists, not a
// vehicle for a drive-by refactor — see CLAUDE.md. Rules that fired
// widely on existing, intentional patterns were turned down rather
// than the code being rewritten to satisfy them; see the comments
// next to each such rule below.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import eslintConfigPrettier from "eslint-config-prettier";

export default tseslint.config(
  {
    // Generated output, vendored deps, personal data, and docs never
    // need linting. web/src/seed holds real note content (CLAUDE.md).
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "web/dist/**",
      "web/dist-demo/**",
      "web/src/seed/**",
      "reports/**",
      "TEMP/**",
      "docs/**",
      "Takeout/**",
      "supabase/**",
      "**/*.tsbuildinfo",
      "web/.vercel/**",
      // Git worktrees are whole second copies of this repo living inside it.
      // Linted, every file is reported twice, and typescript-eslint refuses
      // outright — it finds a tsconfig at each worktree root, cannot choose
      // between them, and fails to parse every file in the repository with
      // "multiple candidate TSConfigRootDirs". One worktree on disk was
      // enough to turn `npm run lint` into 514 parse errors and no signal.
      ".claude/worktrees/**",
    ],
  },

  // Root CLI pipeline: src/ + tests/ — plain Node + TypeScript, no
  // browser globals, no React. The backend conformance suite (conformance/)
  // is Node test code of the same kind and takes the same rules, and so does
  // the spår server (server/), whose typecheck `npm run lint` runs after this.
  {
    files: [
      "src/**/*.ts",
      "tests/**/*.ts",
      "conformance/**/*.ts",
      "server/**/*.ts",
      "server/**/*.mjs",
      "scripts/**/*.{ts,mjs}",
      "web/scripts/**/*.mjs",
      "web/e2e/**/*.ts",
    ],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // The CLI pipeline logs progress/results to the console by
      // design (it's a set of command-line tools, not a library).
      "no-console": "off",
      // better-sqlite3's .get()/.all() return `unknown` typed rows;
      // the CLI casts them at the call site (src/search.ts, tests)
      // rather than hand-writing a row type per query. An established,
      // repeated pattern here, not oversight — warn instead of erroring
      // so it stays visible without blocking. (It used to name three
      // more files; they went with the AI layer.)
      "@typescript-eslint/no-explicit-any": "warn",
      // `const { omitted, ...rest } = obj` to drop one property, the idiom
      // web/src/store/canvasSync.test.ts and web/src/store/db.ts use — the
      // discarded name is intentionally unused.
      "@typescript-eslint/no-unused-vars": ["error", { ignoreRestSiblings: true }],
    },
  },

  // The browser drivers: the functions they hand a page (`evaluate`,
  // `waitForFunction`) run in the browser, so `document` and `window` are
  // real there. (typescript-eslint's set turns `no-undef` off in the block
  // above; this keeps them declared should it ever come back on.)
  {
    files: ["scripts/e2e-spar-server.mjs", "scripts/shots.mjs", "web/e2e/**/*.ts"],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },

  // Web app: web/src/ — React 19 + TypeScript + browser.
  {
    files: ["web/src/**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      globals: { ...globals.browser },
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      // Only the two classic hook-correctness rules are enabled here,
      // not eslint-plugin-react-hooks' full "recommended" bundle —
      // that bundle also enables the newer React Compiler rule set
      // (react-hooks/purity, immutability, set-state-in-render, ...),
      // which is a different, much stricter concern than "are hooks
      // used correctly" and was never part of this project's design.
      "react-hooks/rules-of-hooks": "error",
      // An error, since 2026-09-06. It was a warning because the codebase
      // has deliberate dependency omissions — but every one of those
      // carries its own `eslint-disable-next-line` with the reason beside
      // it, so the rule fires on nothing today, and as a warning a newly
      // omitted dependency passed all four gates without a word. (The
      // four false positives it used to name — a remembered
      // `document.activeElement` read in an effect cleanup — became
      // `lib/useRestoreFocus.ts`, which carries the one remaining late
      // read with its own disable.)
      "react-hooks/exhaustive-deps": "error",
      // `const { omitted, ...rest } = obj` to drop one property, same
      // idiom as the root tests block above.
      "@typescript-eslint/no-unused-vars": ["error", { ignoreRestSiblings: true }],
      // Several regexes/strings in this codebase deliberately contain
      // literal Unicode whitespace and punctuation (e.g. lib/links.ts'
      // URL-boundary regex matches a literal non-breaking space) — the
      // app's own typography handles curly quotes, en/em dashes and
      // NBSP throughout (see web/CLAUDE.md), so this rule is a
      // false-positive generator here rather than a real signal.
      "no-irregular-whitespace": "off",
      // Warning rather than error so a dead store is visible without
      // blocking `npm run lint`. This used to name a specific one in
      // face.ts as still outstanding; it was fixed long ago, and a comment
      // pointing at a bug that is not there invites someone to "fix"
      // working code. There are currently no occurrences.
      "no-useless-assignment": "warn",
    },
  },

  // Type-aware linting for the app's own files, and one rule that needs it.
  // A promise dropped on the floor rejects into the console and nowhere
  // else — `store/useBoards.ts` had eleven of them, and a full quota lost a
  // folder with nothing on screen. Test files are left out: `web/tsconfig`
  // excludes them, so the project service cannot type them, and a test that
  // drops a promise fails on its own. The same goes for `*.node.ts`, the
  // test helpers that read files (`src/test/readStyles.node.ts`). Costs about six seconds a run.
  {
    files: ["web/src/**/*.{ts,tsx}"],
    ignores: ["web/src/**/*.test.{ts,tsx}", "web/src/**/*.node.ts"],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: `${import.meta.dirname}/web` },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
    },
  },

  // The push handler that rides inside the generated service worker.
  // Not bundled and not TypeScript — it is served as-is from /push-sw.js
  // and pulled in by workbox's importScripts (web/vite.config.ts) — so it
  // needs the service worker globals (`self`, `clients`) and none of the
  // TypeScript or React machinery above.
  {
    files: ["web/public/*.js"],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: { ...globals.serviceworker },
      sourceType: "script",
    },
  },

  // The one file in public/ that runs in the page rather than the worker:
  // index.html's theme script, before the app (src/lib/theme.ts says why).
  {
    files: ["web/public/theme-boot.js"],
    languageOptions: {
      globals: { ...globals.browser },
      sourceType: "script",
    },
  },

  // Prettier turns off every ESLint rule that fights the formatter,
  // must stay last.
  eslintConfigPrettier,
);
