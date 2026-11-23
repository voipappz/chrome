# The agent Chrome extension. `make` lists the targets.
#
# Node comes from mise.toml: every command runs through `mise exec`, so it works
# with or without mise activated in the shell.
MISE = mise exec --
NPM  = $(MISE) npm
SPEC ?= mock-

.DEFAULT_GOAL := help
.PHONY: help setup dev build test lint unit e2e live screen-pop pack release clean

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
e2e: build ## [SPEC=mock-] Playwright specs in a real Chrome (default: the offline mock-* specs)
	$(NPM) run test:e2e -- $(SPEC)

# The real switch, from here: does the cable this build connects to answer
# ActionCable? No credential, changes nothing (scripts/check-live-cable.mjs).
live: ## The build's cable (wss://switch.voipappz.io/cable) answers ActionCable
	$(NPM) exec -- node scripts/check-live-cable.mjs

# One screen pop through NATS, as the platform sends it (scripts/screen-pop.mjs).
screen-pop: ## [USER_UUID=x URL=x] Publish tab:new on notifications:<uuid> via wss://switch.voipappz.io/nats (NATS_USER/NATS_PASSWORD or NATS_TOKEN)
	@test -n "$(USER_UUID)" || { echo "usage: make screen-pop USER_UUID=<agent uuid> [URL=https://...]  (NATS_USER/NATS_PASSWORD or NATS_TOKEN in the env)"; exit 1; }
	$(NPM) exec -- node scripts/screen-pop.mjs "$(USER_UUID)" $(URL)

# A release is a tag: .github/workflows/release.yml builds, tests and
# publishes it as a GitHub Release with the zip attached (not the Web Store).
release: ## [VERSION=0.0.11] Tag vVERSION and push it: GitHub Actions builds and releases it
	@test -n "$(VERSION)" || { echo "usage: make release VERSION=0.0.11"; exit 1; }
	@echo "$(VERSION)" | grep -Eq '^[0-9]{1,5}(\.[0-9]{1,5}){0,3}$$' || { echo "VERSION must be 1-4 dot-separated integers (a Chrome version)"; exit 1; }
	@test -z "$$(git status --porcelain)" || { echo "commit or stash your changes first"; exit 1; }
	@test "$$(git rev-parse --abbrev-ref HEAD)" = main || { echo "release from main"; exit 1; }
	git fetch -q origin main && test "$$(git rev-parse HEAD)" = "$$(git rev-parse origin/main)" || { echo "main is not in sync with origin/main"; exit 1; }
	git tag -a "v$(VERSION)" -m "Release $(VERSION)"
	git push origin "v$(VERSION)"
	@echo "release v$(VERSION): https://github.com/connectix-io/chrome/actions/workflows/release.yml"

# EXT_VERSION overrides the version for one build (manifest.config.js).
pack: build ## [EXT_VERSION=x] Zip dist/ to extension-build.zip
	@rm -f extension-build.zip
	cd dist && python3 -m zipfile -c ../extension-build.zip *
	@echo "package -> $(CURDIR)/extension-build.zip"

clean: ## Remove dist/ and test output
	rm -rf dist test-results playwright-report extension-build.zip
