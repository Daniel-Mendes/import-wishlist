.DEFAULT_GOAL := help
.PHONY: help clean copy copy-chrome-manifest copy-firefox-manifest build-chrome build-firefox zip-chrome zip-firefox

help: ## Display list of commands
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-30s\033[0m %s\n", $$1, $$2}'

clean: ## Clean dist/ folder and .zip files
	rm -rf dist import-wishlist_*.zip

clean-chrome: ## Clean dist/ folder and  import-wishlist_chrome.zip files
	rm -rf dist import-wishlist_chrome.zip

clean-firefox: ## Clean dist/ folder and   import-wishlist_firefox.zip files
	rm -rf dist import-wishlist_firefox.zip

copy: ## Copy src/ folder to dist/ folder
	mkdir -p ./dist
	cp -r ./src/assets ./src/background ./src/content ./src/popup dist/

copy-chrome-manifest: ## Copy src/manifest-chrome.json to dist/manifest.json
	cp ./src/manifest-chrome.json ./dist/manifest.json

copy-firefox-manifest: ## Copy src/manifest-firefox.json to dist/manifest.json
	cp ./src/manifest-firefox.json ./dist/manifest.json

build-chrome: clean-chrome copy copy-chrome-manifest zip-chrome ## Build Chrome project

build-firefox: clean-firefox copy copy-firefox-manifest zip-firefox ## Build Firefox project

zip-chrome: ## Zip Chrome extension
	cd dist && zip -FSr ../import-wishlist_chrome.zip .

zip-firefox: ## Zip Firefox extension
	cd dist && zip -FSr ../import-wishlist_firefox.zip .