.PHONY: help install dev build preview check lint deploy stations integration clean

help: ## Show available commands
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies
	pnpm install

dev: ## Dev server on :4321
	pnpm dev

build: ## Production build (verifies the station index first)
	pnpm build

preview: ## Serve the production build locally
	pnpm preview

check: ## Astro + TypeScript diagnostics
	pnpm check

stations: ## Rebuild data/stations.json from Sensor.Community (commit the result)
	pnpm stations

integration: ## Run the pipeline against live upstreams — no browser, no build
	pnpm integration

deploy: ## Build and deploy to Cloudflare Pages
	pnpm deploy

clean: ## Remove build output and caches
	rm -rf dist .astro node_modules/.vite
