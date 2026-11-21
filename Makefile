# The agent Chrome extension. `make` lists the targets.
#
# Node comes from mise.toml: every command runs through `mise exec`, so it works
# with or without mise activated in the shell.
MISE = mise exec --
NPM  = $(MISE) npm
SPEC ?= mock-realtime

.DEFAULT_GOAL := help
.PHONY: help setup dev build test lint unit e2e pack clean

help: ## Show this help
	@awk 'BEGIN { FS = ":.*## " } /^[a-z0-9-]+:.*## / { printf "  \033[36m%-8s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

setup: ## Install node (mise), the dependencies and Chromium for the e2e specs
	mise install
	$(NPM) ci --no-audit --no-fund
	$(NPM) exec -- playwright install chromium

# HMR inside the real extension; a service-worker edit still needs the reload
# button in chrome://extensions. The popup also opens as a plain page.
dev: ## Keep dist/ live; popup also at http://localhost:5175/index.html
	$(NPM) run dev

build: ## Build into dist/ (chrome://extensions -> Load unpacked)
	$(NPM) run build
	@echo "extension -> $(CURDIR)/dist  (chrome://extensions -> Load unpacked)"

test: lint unit e2e ## Lint, unit tests, then the offline e2e specs

lint: ## ESLint
	$(NPM) run lint

unit: ## Vitest
	$(NPM) run test:unit

# A real Chrome with dist/ loaded. With no SPEC, the offline suite (a fake node:
# no server, no credentials); see README.md for the live specs and their env.
e2e: build ## [SPEC=mock-realtime] Playwright specs in a real Chrome
	$(NPM) run test:e2e -- $(SPEC)

# EXT_VERSION overrides the version for one build (manifest.config.js).
pack: build ## [EXT_VERSION=x] Zip dist/ to extension-build.zip
	@rm -f extension-build.zip
	cd dist && python3 -m zipfile -c ../extension-build.zip *
	@echo "package -> $(CURDIR)/extension-build.zip"

clean: ## Remove dist/ and test output
	rm -rf dist test-results playwright-report extension-build.zip
