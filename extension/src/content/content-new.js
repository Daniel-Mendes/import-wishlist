// Les scripts partagés sont chargés par l'injector
// Attendre que les globals soient disponibles
function waitForGlobals() {
  return new Promise((resolve) => {
    const checkGlobals = () => {
      if (self.MessageTypes && self.ValidationUtils && self.ErrorUtils) {
        console.log("[Content Script] Global dependencies found");
        resolve();
      } else {
        console.log("[Content Script] Waiting for global dependencies...");
        setTimeout(checkGlobals, 100);
      }
    };
    checkGlobals();
  });
}

// Définition de la classe (sera initialisée une fois les globals chargés)
class SecureContentScript {
  constructor() {
    // Récupérer les références globales
    this.MessageTypes = self.MessageTypes;
    this.ValidationSchemas = self.ValidationSchemas;
    this.ValidationUtils = self.ValidationUtils;
    this.ErrorUtils = self.ErrorUtils;

    // Détecter le contexte d'exécution
    this.hasDirectChromeAccess =
      typeof chrome !== "undefined" && chrome.runtime;

    // Configurer les listeners seulement si on a accès direct à chrome.runtime
    if (this.hasDirectChromeAccess) {
      console.log(
        "[Content Script] Setting up chrome.runtime message listener"
      );
      this.setupMessageListener();
    } else {
      console.log(
        "[Content Script] Skipping message listener setup (injected context)"
      );
    }
  }

  setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      try {
        this.handleMessage(message, sender, sendResponse);
      } catch (error) {
        this.ErrorUtils.logError(error, "Content script message handling");
        this.sendErrorMessage("Failed to handle message", error);
      }
    });
  }

  handleMessage(message, sender, sendResponse) {
    switch (message.type) {
      case "gogGetAccessToken":
        this.extractGogTokens();
        break;
      default:
        console.warn("[Content Script] Unknown message type:", message.type);
    }
  }

  extractGogTokens() {
    try {
      console.log("[Content Script] Starting GOG token extraction...");
      console.log("[Content Script] Current URL:", window.location.href);

      // Vérifier si on est sur la page on_login_success avec un code d'autorisation
      if (window.location.pathname.includes("on_login_success")) {
        const urlParams = new URLSearchParams(window.location.search);
        const authCode = urlParams.get("code");
        const origin = urlParams.get("origin");

        if (authCode) {
          console.log("[Content Script] Authorization code found in URL");
          const authData = {
            authorization_code: authCode,
            origin: origin || "client",
            url: window.location.href,
            timestamp: new Date().toISOString(),
          };

          this.sendAuthCodeToBackground(authData);

          // Fermer automatiquement la page après envoi du code
          this.schedulePageClose();
          return;
        } else {
          console.log(
            "[Content Script] No authorization code in URL, looking for JSON tokens..."
          );
        }
      }

      // Fallback: chercher des tokens JSON dans la page (comportement original)
      const tokenElement = this.findTokenElement();

      if (!tokenElement) {
        throw new Error("Token container element not found");
      }

      console.log("[Content Script] Token element found:", tokenElement);

      // Extraction et validation des tokens
      const tokens = this.parseTokenData(tokenElement);

      console.log("[Content Script] Tokens parsed:", {
        ...tokens,
        access_token: "***",
      });

      // Validation des tokens requis
      this.validateTokens(tokens);

      // Envoi des tokens au background script
      this.sendTokensToBackground(tokens);
    } catch (error) {
      ErrorUtils.logError(error, "GOG token extraction");
      this.sendErrorMessage("Failed to extract GOG tokens", error);
    }
  }

  findTokenElement() {
    // Recherche sécurisée de l'élément contenant les tokens
    const preElements = document.getElementsByTagName("pre");

    if (preElements.length === 0) {
      throw new Error("No <pre> elements found on page");
    }

    // Vérifier le premier élément <pre>
    const tokenElement = preElements[0];

    if (!tokenElement.innerHTML || tokenElement.innerHTML.trim() === "") {
      throw new Error("Token element is empty");
    }

    return tokenElement;
  }

  parseTokenData(element) {
    try {
      const rawData = element.innerHTML.trim();

      // Vérification de base du format JSON
      if (!rawData.startsWith("{") || !rawData.endsWith("}")) {
        throw new Error("Invalid JSON format detected");
      }

      // Parsing sécurisé du JSON
      const tokenData = JSON.parse(rawData);

      if (!tokenData || typeof tokenData !== "object") {
        throw new Error("Parsed data is not a valid object");
      }

      return tokenData;
    } catch (parseError) {
      if (parseError instanceof SyntaxError) {
        throw new Error("Invalid JSON syntax in token data");
      }
      throw parseError;
    }
  }

  validateTokens(tokens) {
    this.ValidationUtils.validateSchema(
      tokens,
      this.ValidationSchemas.GOG_TOKEN
    );

    // Validation basique du format des tokens
    this.validateTokenFormat(tokens.access_token, "access_token");
    this.validateTokenFormat(tokens.refresh_token, "refresh_token");
    this.validateUserId(tokens.user_id);
  }

  validateTokenFormat(token, tokenType) {
    // Validation de base du format des tokens (généralement des chaînes longues)
    if (token.length < 10) {
      throw new Error(`${tokenType} appears to be too short`);
    }

    // Vérifier qu'il ne contient pas de caractères dangereux
    const dangerousChars = /[<>\"'&]/;
    if (dangerousChars.test(token)) {
      throw new Error(`${tokenType} contains potentially dangerous characters`);
    }
  }

  validateUserId(userId) {
    // Validation de l'ID utilisateur (généralement numérique)
    if (!/^\d+$/.test(userId)) {
      throw new Error("User ID should be numeric");
    }

    if (userId === "0" || userId.length < 1) {
      throw new Error("Invalid user ID value");
    }
  }

  sendAuthCodeToBackground(authData) {
    try {
      console.log("[Content Script] Sending authorization code to background");

      // Vérifier si nous avons accès à chrome.runtime (content script direct)
      if (this.hasDirectChromeAccess) {
        console.log("[Content Script] Using chrome.runtime to send auth code");
        chrome.runtime.sendMessage({
          type: this.MessageTypes.AUTH_GOG_CODE_EXTRACTED,
          authCode: authData.authorization_code,
          origin: authData.origin,
          url: authData.url,
          timestamp: authData.timestamp,
        });
      } else {
        // Contexte injecté - utiliser les événements personnalisés
        console.log("[Content Script] Using custom events to send auth code");
        const event = new CustomEvent("gogAuthCodeExtracted", {
          detail: {
            type: this.MessageTypes.AUTH_GOG_CODE_EXTRACTED,
            authCode: authData.authorization_code,
            origin: authData.origin,
            url: authData.url,
            timestamp: authData.timestamp,
          },
        });
        document.dispatchEvent(event);
      }

      console.log("[Content Script] Authorization code sent successfully");
    } catch (error) {
      this.ErrorUtils.logError(
        error,
        "Sending authorization code to background"
      );
      this.sendErrorMessage("Failed to send authorization code", error);
    }
  }

  sendTokensToBackground(tokens) {
    try {
      // Nettoyer les tokens avant envoi
      const cleanTokens = {
        access_token: tokens.access_token.trim(),
        refresh_token: tokens.refresh_token.trim(),
        user_id: tokens.user_id.trim(),
      };

      // Vérifier si nous avons accès à chrome.runtime (content script direct)
      if (this.hasDirectChromeAccess) {
        // Envoyer au background script avec le nouveau système de messages
        chrome.runtime.sendMessage({
          type: MessageTypes.AUTH_GOG_TOKEN_EXTRACTED,
          tokens: cleanTokens,
          timestamp: new Date().toISOString(),
          source: "content_script",
        });
      } else {
        // Si nous sommes dans un script injecté, utiliser des événements personnalisés
        console.log("[Content Script] Using custom event communication...");

        // Créer un événement personnalisé pour communiquer avec le content injector
        const event = new CustomEvent("gogTokensExtracted", {
          detail: {
            type: this.MessageTypes.AUTH_GOG_TOKEN_EXTRACTED,
            tokens: cleanTokens,
            timestamp: new Date().toISOString(),
            source: "injected_script",
          },
        });

        document.dispatchEvent(event);
      }

      console.log(
        "[Content Script] GOG tokens extracted and sent successfully"
      );
    } catch (error) {
      throw new Error(`Failed to send tokens to background: ${error.message}`);
    }
  }

  schedulePageClose() {
    try {
      console.log("[Content Script] Scheduling page close in 3 seconds...");

      // Afficher un message à l'utilisateur
      this.showCloseMessage();

      // Fermer la page après 3 secondes pour laisser le temps à l'utilisateur de voir le succès
      setTimeout(() => {
        console.log("[Content Script] Closing authentication page...");
        try {
          // Essayer de fermer la fenêtre/onglet
          window.close();

          // Vérifier si la fenêtre s'est fermée après un court délai
          setTimeout(() => {
            if (!window.closed) {
              console.log(
                "[Content Script] Window did not close, trying alternative method..."
              );
              // Au lieu d'about:blank, essayer de fermer via l'historique
              if (window.history.length > 1) {
                window.history.back();
              } else {
                // En dernier recours, afficher un message pour fermeture manuelle
                this.showManualCloseMessage();
              }
            }
          }, 500);
        } catch (error) {
          console.warn(
            "[Content Script] Could not close window automatically:",
            error
          );
          // En dernier recours, afficher un message à l'utilisateur
          this.showManualCloseMessage();
        }
      }, 3000);
    } catch (error) {
      console.error("[Content Script] Error scheduling page close:", error);
    }
  }

  // Fonction pour détecter la langue de l'utilisateur
  getLanguage() {
    // Détecter la langue via le navigateur ou l'extension
    const browserLang = navigator.language || navigator.userLanguage;

    // Supporter français et anglais, par défaut anglais
    if (browserLang.startsWith("fr")) {
      return "fr";
    }
    return "en";
  }

  // Fonction pour obtenir les messages traduits
  getLocalizedMessages() {
    const lang = this.getLanguage();

    const messages = {
      fr: {
        success: "✅ Authentification GOG réussie !",
        autoClose: "Cette page va se fermer automatiquement dans 3 secondes...",
        manualClose: "Vous pouvez maintenant fermer cette page manuellement.",
      },
      en: {
        success: "✅ GOG Authentication Successful!",
        autoClose: "This page will close automatically in 3 seconds...",
        manualClose: "You can now close this page manually.",
      },
    };

    return messages[lang];
  }

  showCloseMessage() {
    try {
      const messages = this.getLocalizedMessages();

      // Créer un message de succès visible
      const messageDiv = document.createElement("div");
      messageDiv.id = "gog-auth-success-message";
      messageDiv.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: #4CAF50;
        color: white;
        padding: 20px 30px;
        border-radius: 8px;
        font-family: Arial, sans-serif;
        font-size: 16px;
        font-weight: bold;
        text-align: center;
        z-index: 10000;
        box-shadow: 0 4px 8px rgba(0,0,0,0.3);
        animation: fadeIn 0.3s ease-in;
      `;

      // Ajouter l'animation CSS
      const style = document.createElement("style");
      style.textContent = `
        @keyframes fadeIn {
          from { opacity: 0; transform: translate(-50%, -50%) scale(0.9); }
          to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        }
      `;
      document.head.appendChild(style);

      messageDiv.innerHTML = `
        <div>${messages.success}</div>
        <div style="font-size: 14px; margin-top: 10px; font-weight: normal;">
          ${messages.autoClose}
        </div>
      `;

      document.body.appendChild(messageDiv);
    } catch (error) {
      console.error("[Content Script] Error showing close message:", error);
    }
  }

  showManualCloseMessage() {
    try {
      const messages = this.getLocalizedMessages();
      const messageDiv = document.getElementById("gog-auth-success-message");

      if (messageDiv) {
        messageDiv.innerHTML = `
          <div>${messages.success}</div>
          <div style="font-size: 14px; margin-top: 10px; font-weight: normal;">
            ${messages.manualClose}
          </div>
        `;
        messageDiv.style.background = "#2196F3";
      }
    } catch (error) {
      console.error(
        "[Content Script] Error showing manual close message:",
        error
      );
    }
  }

  sendErrorMessage(message, error) {
    try {
      const errorData = {
        type: this.MessageTypes.AUTH_GOG_ERROR,
        error: message,
        details: error?.message || "Unknown error",
        timestamp: new Date().toISOString(),
        source: "content_script",
      };

      if (this.hasDirectChromeAccess) {
        chrome.runtime.sendMessage(errorData);
      } else {
        // Utiliser des événements personnalisés si nous sommes dans un script injecté
        const event = new CustomEvent("gogTokenError", {
          detail: errorData,
        });
        document.dispatchEvent(event);
      }
    } catch (sendError) {
      console.error(
        "[Content Script] Failed to send error message:",
        sendError
      );
    }
  }

  // Méthode pour vérifier si la page actuelle est une page de tokens GOG
  isGogTokenPage() {
    try {
      // Vérifier l'URL
      const isCorrectUrl = window.location.href.includes(
        "embed.gog.com/on_login_success"
      );
      console.log(
        "[Content Script] URL check:",
        isCorrectUrl,
        window.location.href
      );

      if (!isCorrectUrl) {
        return false;
      }

      // Si on est sur la page on_login_success, vérifier s'il y a un code dans l'URL
      const urlParams = new URLSearchParams(window.location.search);
      const hasAuthCode = urlParams.has("code");
      console.log("[Content Script] Auth code in URL check:", hasAuthCode);

      // Vérifier la présence d'éléments <pre> pour les tokens JSON (fallback)
      const hasPreElement = document.getElementsByTagName("pre").length > 0;
      console.log("[Content Script] Pre element check:", hasPreElement);

      // Page valide si on a soit un code d'autorisation, soit des éléments <pre>
      const result = hasAuthCode || hasPreElement;
      console.log("[Content Script] isGogTokenPage result:", result);

      return result;
    } catch (error) {
      this.ErrorUtils.logError(error, "Token page verification");
      return false;
    }
  }

  // Auto-extraction si on détecte qu'on est sur la bonne page
  autoExtractIfReady() {
    console.log("[Content Script] Checking if GOG token page...");
    console.log("[Content Script] Current URL:", window.location.href);

    if (this.isGogTokenPage()) {
      console.log(
        "[Content Script] GOG token page detected, starting extraction..."
      );
      // Attendre un peu que la page se charge complètement
      setTimeout(() => {
        this.extractGogTokens();
      }, 500);
    } else {
      console.log("[Content Script] Not a GOG token page");
    }
  }
}

// Initialisation une fois les globals disponibles
waitForGlobals()
  .then(() => {
    console.log("[Content Script] Starting initialization...");
    console.log("[Content Script] Current URL:", window.location.href);
    console.log("[Content Script] Document ready state:", document.readyState);

    // Vérifier que nous sommes dans un contexte valide
    const hasDirectChromeAccess =
      typeof chrome !== "undefined" && chrome.runtime;

    if (hasDirectChromeAccess) {
      console.log(
        "[Content Script] Chrome runtime available - running as content script"
      );
    } else {
      console.log(
        "[Content Script] Chrome runtime not available - running as injected script"
      );
    }

    // Créer l'instance dans tous les cas
    const contentScript = new SecureContentScript();

    // Auto-extraction si on détecte qu'on est sur une page de tokens
    if (document.readyState === "loading") {
      console.log(
        "[Content Script] Document loading, waiting for DOMContentLoaded..."
      );
      document.addEventListener("DOMContentLoaded", () => {
        console.log(
          "[Content Script] DOMContentLoaded fired, auto-extracting..."
        );
        contentScript.autoExtractIfReady();
      });
    } else {
      console.log(
        "[Content Script] Document ready, auto-extracting immediately..."
      );
      contentScript.autoExtractIfReady();
    }

    console.log("[Content Script] Secure content script initialized");
  })
  .catch((error) => {
    console.error("[Content Script] Failed to initialize:", error);
  });
