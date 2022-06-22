.DEFAULT_GOAL := help
.PHONY: help clean copy build-chrome build-firefox zip-chrome zip-firefox

help: ## Display list of commands
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-30s\033[0m %s\n", $$1, $$2}'

clean: ## Clean dist/ folder and .zip files
	rm -rf dist import-wishlist_*.zip

copy: ## Copy src/ folder to dist/ folder
	cp -r src/assets src/background src/content src/popup dist

build-chrome: clean copy ## Build Chrome project
	cp ./src/manifest-chrome.json ./dist/manifest.json
	zip-chrome

build-firefox: clean copy ## Build Firefox project
	cp ./src/manifest-chrome.json ./dist/manifest.json
	zip-chrome

zip-chrome: ## Zip Chrome extension
	cd dist && zip -FSr ../import-wishlist_chrome.zip .

zip-firefox: ## Zip Firefox extension
	cd dist && zip -FSr ../import-wishlist_firefox.zip .