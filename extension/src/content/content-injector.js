// Content injector - Injecte le vrai content script en tant que module ES6
console.log("[Content Injector] Starting injection...");

// Écouter les événements personnalisés du script injecté
document.addEventListener("gogTokensExtracted", (event) => {
  console.log("[Content Injector] Received tokens from injected script");

  if (chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage(event.detail);
  }
});

document.addEventListener("gogAuthCodeExtracted", (event) => {
  console.log("[Content Injector] Received auth code from injected script");

  if (chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage(event.detail);
  }
});

document.addEventListener("gogTokenError", (event) => {
  console.log("[Content Injector] Received error from injected script");

  if (chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage(event.detail);
  }
});
async function loadScript(src, type = "text/javascript") {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.type = type;
    script.src = src;

    script.onload = () => {
      console.log("[Content Injector] Loaded:", src);
      resolve();
    };

    script.onerror = (error) => {
      console.error("[Content Injector] Failed to load:", src, error);
      reject(error);
    };

    (document.head || document.documentElement).appendChild(script);
  });
}

async function initializeContentScript() {
  try {
    // Charger les dépendances dans l'ordre
    const utilsUrl = chrome.runtime.getURL("shared/utils.js");
    const constantsUrl = chrome.runtime.getURL("shared/constants.js");
    const contentUrl = chrome.runtime.getURL("content/content-new.js");

    console.log("[Content Injector] Loading dependencies...");

    // Charger utils.js et constants.js d'abord
    await loadScript(utilsUrl);
    await loadScript(constantsUrl);

    console.log(
      "[Content Injector] Dependencies loaded, loading main script..."
    );

    // Puis charger le script principal
    await loadScript(contentUrl);

    console.log("[Content Injector] All scripts loaded successfully");
  } catch (error) {
    console.error("[Content Injector] Injection failed:", error);
  }
}

// Démarrer l'initialisation
initializeContentScript();
