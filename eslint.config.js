const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
  {
    ignores: [
      ".joblio-data/**",
      "backups/**",
      "docker-data/**",
      "docker-backups/**",
      "assets/js/joblio.bundle.js"
    ],
    linterOptions: {
      reportUnusedDisableDirectives: "off"
    }
  },
  js.configs.recommended,
  {
    files: ["server.js", "lib/**/*.js", "scripts/**/*.js", "eslint.config.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "script",
      globals: {
        ...globals.node
      }
    },
    rules: {
      "no-empty": "off",
      "no-redeclare": "off",
      "no-useless-escape": "off",
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-console": "off"
    }
  },
  {
    files: ["assets/js/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser
      }
    },
    rules: {
      "no-empty": "off",
      "no-redeclare": "off",
      "no-useless-escape": "off",
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-console": "off"
    }
  }
];
