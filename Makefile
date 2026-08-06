.PHONY: help install dev build preview check deploy wasm db-init db-reset seed ingest integration clean

# Where the Rust core lives. Only `make wasm` needs it; everything else runs off the vendored
# artifacts in src/wasm/, so a fresh checkout builds without a Rust toolchain.
AIRQ ?= $(HOME)/startups/active/airq

help: ## Show available commands
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies
	pnpm install

dev: ## Dev server on :4321, against the local D1
	pnpm dev

build: ## Production build (SSR worker + assets)
	pnpm build

preview: ## Serve the built worker locally via wrangler
	pnpm preview

check: ## Astro + TypeScript diagnostics
	pnpm check

wasm: ## Rebuild both airq-core WASM builds from $(AIRQ) and vendor them into src/wasm/
	cd $(AIRQ)/airq-core && wasm-pack build --target nodejs --out-dir pkg-node \
		--features "wasm,cities" --no-default-features
	cd $(AIRQ)/airq-core && wasm-pack build --target web --out-dir pkg-web \
		--features wasm --no-default-features
	cp $(AIRQ)/airq-core/pkg-node/airq_core.js $(AIRQ)/airq-core/pkg-node/airq_core*.d.ts \
		$(AIRQ)/airq-core/pkg-node/airq_core_bg.wasm src/wasm/node/
	cp $(AIRQ)/airq-core/pkg-web/airq_core.js $(AIRQ)/airq-core/pkg-web/airq_core*.d.ts \
		$(AIRQ)/airq-core/pkg-web/airq_core_bg.wasm src/wasm/web/
	@ls -l src/wasm/node/airq_core_bg.wasm src/wasm/web/airq_core_bg.wasm

db-init: ## Apply the schema to the local D1
	pnpm db:init

db-reset: ## Drop and recreate the local D1 from scratch
	pnpm db:reset

seed: ## One-off: load the cities database from WASM into D1
	pnpm seed

ingest: ## Full ETL pass against live upstreams into the local D1
	pnpm ingest

integration: ## Run the pipeline against live upstreams — no browser, no build
	pnpm integration

deploy: ## Build and deploy the worker to Cloudflare
	# `pnpm deploy` is a built-in pnpm command (it deploys a workspace package) and shadows the
	# script, failing with ERR_PNPM_CANNOT_DEPLOY. `pnpm run` is unambiguous.
	pnpm run deploy

clean: ## Remove build output and caches
	rm -rf dist .astro .wrangler node_modules/.vite
