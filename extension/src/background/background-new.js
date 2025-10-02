// import { MessageHandler } from "./MessageHandler.js";
// import { ErrorUtils } from "../shared/utils.js";

importScripts(
  "../shared/constants.js", // Constantes (pas de dépendances)
  "../shared/utils.js", // Utilitaires (pas de dépendances)
  "../shared/StateMachine.js", // StateMachine (dépend de constants et utils)
  "./services/StorageService.js", // StorageService (dépend de utils et constants)
  "./services/ApiService.js", // ApiService (dépend de utils et constants)
  "./services/AuthService.js", // AuthService (dépend des services précédents)
  "./services/WishlistService.js", // WishlistService (dépend de tous les services)
  "./MessageHandler.js" // MessageHandler (dépend de tous les services et StateMachine)
);

// Instance globale du gestionnaire de messages
let messageHandler;

// Initialisation au démarrage de l'extension
async function initializeExtension() {
  try {
    messageHandler = new MessageHandler();
    console.log("[Background] Extension initialized successfully");
  } catch (error) {
    ErrorUtils.logError(error, "Extension initialization");
  }
}

// Gestion des messages entre scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!messageHandler) {
    sendResponse({ success: false, error: "Extension not initialized" });
    return;
  }

  // Traitement asynchrone des messages
  messageHandler
    .handleMessage(message, sender, sendResponse)
    .then((result) => {
      sendResponse(result);
    })
    .catch((error) => {
      ErrorUtils.logError(error, "Message handling error");
      sendResponse({ success: false, error: error.message });
    });

  // Retourner true pour indiquer une réponse asynchrone
  return true;
});

// Gestion de la navigation web (pour l'authentification GOG)
chrome.webNavigation.onCompleted.addListener((data) => {
  if (!messageHandler) return;

  try {
    // Vérifier si c'est une page de succès d'authentification GOG
    if (data.url.includes("embed.gog.com/on_login_success")) {
      // Injecter le script de récupération des tokens (Manifest V3)
      chrome.scripting.executeScript({
        target: { tabId: data.tabId },
        func: (tabId) => {
          try {
            const preElement = document.getElementsByTagName("pre")[0];
            if (preElement) {
              chrome.runtime.sendMessage({
                type: "AUTH_GOG_TOKEN_EXTRACTED",
                tokens: JSON.parse(preElement.innerHTML),
                tabId: tabId,
              });
            }
          } catch (error) {
            chrome.runtime.sendMessage({
              type: "AUTH_GOG_ERROR",
              error: "Failed to extract GOG tokens: " + error.message,
            });
          }
        },
        args: [data.tabId],
      });
    }
  } catch (error) {
    ErrorUtils.logError(error, "Web navigation handling");
  }
});

// Gestion des permissions
chrome.permissions.contains(
  { permissions: ["webRequest", "webRequestBlocking"] },
  (result) => {
    if (result) {
      console.log("[Background] Required permissions available");
    } else {
      console.warn("[Background] Missing required permissions");
    }
  }
);

// Initialiser l'extension
initializeExtension();
