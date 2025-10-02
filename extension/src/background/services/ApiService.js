// import { ValidationUtils, ErrorUtils, PromiseUtils } from "../shared/utils.js";
// import { ErrorTypes, ApiUrls } from "../shared/constants.js";

class ApiService {
  constructor() {
    this.defaultTimeout = 10000; // 10 secondes
    this.steamWishlistCache = null; // Cache pour la wishlist Steam
    this.steamWishlistTimestamp = null; // Timestamp du cache
  }

  async makeRequest(url, options = {}) {
    const defaultOptions = {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      ...options,
    };

    try {
      const response = await PromiseUtils.withTimeout(
        fetch(url, defaultOptions),
        this.defaultTimeout,
        "Request timeout"
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return response;
    } catch (error) {
      throw ErrorUtils.createError(
        ErrorTypes.NETWORK_ERROR,
        `API request failed: ${url}`,
        error
      );
    }
  }

  async get(url, headers = {}) {
    return this.makeRequest(url, {
      method: "GET",
      headers: { ...headers },
    });
  }

  async post(url, data = null, headers = {}) {
    const options = {
      method: "POST",
      headers: { ...headers },
    };

    if (data) {
      if (typeof data === "object") {
        options.body = JSON.stringify(data);
      } else {
        options.body = data;
      }
    }

    return this.makeRequest(url, options);
  }

  async getJson(url, headers = {}) {
    try {
      console.log("[ApiService] Making request to:", url);
      const response = await this.get(url, headers);
      console.log(
        "[ApiService] Response status:",
        response.status,
        response.statusText
      );
      console.log("[ApiService] Response headers:", [
        ...response.headers.entries(),
      ]);

      const contentType = response.headers.get("content-type");
      console.log("[ApiService] Content-Type:", contentType);

      if (!response.ok) {
        const errorText = await response.text();
        console.error("[ApiService] Error response body:", errorText);
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Si ce n'est pas du JSON, afficher le contenu pour diagnostic
      if (!contentType || !contentType.includes("application/json")) {
        const text = await response.text();
        console.warn(
          "[ApiService] Non-JSON response received:",
          text.substring(0, 200) + "..."
        );

        // Si c'est du HTML avec une page de login, retourner un objet vide
        if (text.includes("<!DOCTYPE") || text.includes("<html")) {
          console.warn(
            "[ApiService] Steam returned login page, user might not be authenticated"
          );
          return {}; // Retourner un objet vide au lieu d'échouer
        }

        throw new Error(`Expected JSON but received ${contentType}`);
      }

      const data = await response.json();
      console.log(
        "[ApiService] Successfully parsed JSON, keys:",
        Object.keys(data || {})
      );
      return data;
    } catch (error) {
      console.error("[ApiService] getJson error details:", error);
      throw ErrorUtils.createError(
        ErrorTypes.NETWORK_ERROR,
        `Failed to get JSON from ${url}`,
        error
      );
    }
  }

  async getText(url, headers = {}) {
    try {
      const response = await this.get(url, headers);
      const text = await response.text();
      return text;
    } catch (error) {
      throw ErrorUtils.createError(
        ErrorTypes.NETWORK_ERROR,
        `Failed to get text from ${url}`,
        error
      );
    }
  }

  async getXml(url, headers = {}) {
    try {
      const text = await this.getText(url, headers);
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(text, "text/xml");

      // Vérifier les erreurs de parsing
      const parseError = xmlDoc.querySelector("parsererror");
      if (parseError) {
        throw new Error("XML parsing error: " + parseError.textContent);
      }

      return xmlDoc;
    } catch (error) {
      throw ErrorUtils.createError(
        ErrorTypes.VALIDATION_ERROR,
        `Failed to parse XML from ${url}`,
        error
      );
    }
  }

  // Méthodes spécialisées avec validation

  async getSteamProfile(userId) {
    const url = ApiUrls.STEAM.PROFILE(userId);

    try {
      const xmlDoc = await this.getXml(url);

      const profile = {
        steamID: this.getXmlElementText(xmlDoc, "steamID"),
        avatarFull: this.getXmlElementText(xmlDoc, "avatarFull"),
        customURL: this.getXmlElementText(xmlDoc, "customURL"),
      };

      ValidationUtils.validateSchema(profile, ValidationSchemas.STEAM_PROFILE);
      return profile;
    } catch (error) {
      throw ErrorUtils.createError(
        ErrorTypes.VALIDATION_ERROR,
        `Invalid Steam profile data for user ${userId}`,
        error
      );
    }
  }

  async getGogProfile(accessToken) {
    const url = ApiUrls.GOG.PROFILE;

    try {
      const profile = await this.getJson(url, {
        Authorization: `Bearer ${accessToken}`,
      });

      ValidationUtils.validateSchema(profile, ValidationSchemas.GOG_PROFILE);
      return profile;
    } catch (error) {
      throw ErrorUtils.createError(
        ErrorTypes.VALIDATION_ERROR,
        "Invalid GOG profile data",
        error
      );
    }
  }

  async getSteamWishlist(userId, forceRefresh = false) {
    console.log("[ApiService] Requesting Steam wishlist for user:", userId);

    // Vérifier le cache d'abord (valide pendant 10 minutes)
    const cacheAge = this.steamWishlistTimestamp
      ? Date.now() - this.steamWishlistTimestamp
      : Infinity;
    const cacheValid = cacheAge < 10 * 60 * 1000; // 10 minutes

    if (!forceRefresh && this.steamWishlistCache && cacheValid) {
      console.log("[ApiService] ✅ Using cached Steam wishlist data", {
        games: Object.keys(this.steamWishlistCache).length,
        ageMinutes: Math.round(cacheAge / 60000),
      });
      return this.steamWishlistCache;
    }

    try {
      console.log("[ApiService] 🔄 Fetching fresh Steam wishlist data...");

      // Utiliser seulement le mode manuel avec scroll assistance
      const allGames = await this.getSteamWishlistWithManualScroll(userId);

      if (allGames && allGames.length > 0) {
        console.log(
          `[ApiService] ✅ Successfully got ${allGames.length} games via manual scroll`
        );

        // Construire un objet compatible avec l'ancien format
        const wishlistData = {};
        allGames.forEach((gameId, index) => {
          wishlistData[gameId] = {
            appid: parseInt(gameId),
            position: index,
            added: Date.now(),
          };
        });

        // Mettre en cache le résultat
        this.steamWishlistCache = wishlistData;
        this.steamWishlistTimestamp = Date.now();
        console.log("[ApiService] 💾 Cached Steam wishlist data");

        return wishlistData;
      }

      throw new Error("No games found in wishlist");
    } catch (error) {
      console.error("[ApiService] Steam wishlist error:", error);
      throw ErrorUtils.createError(
        ErrorTypes.VALIDATION_ERROR,
        `Failed to get Steam wishlist data for user ${userId}`,
        error
      );
    }
  }

  // Méthode pour vider le cache de wishlist Steam
  clearSteamWishlistCache() {
    console.log("[ApiService] 🗑️ Clearing Steam wishlist cache...");
    this.steamWishlistCache = null;
    this.steamWishlistTimestamp = null;
  }

  // Méthode pour utiliser un content script avec scroll manuel seulement
  async getSteamWishlistWithManualScroll(userId) {
    try {
      console.log(
        "[ApiService] 🎮 Using manual scroll assistance for wishlist extraction..."
      );

      // Créer une nouvelle fenêtre pour l'assistance manuelle
      const window = await chrome.windows.create({
        url: ApiUrls.STEAM.WISHLIST(userId),
        type: "normal",
        width: 1200,
        height: 800,
        focused: true, // Donner le focus pour permettre l'interaction manuelle
        left: 100,
        top: 100,
      });

      const tabId = window.tabs[0].id;
      console.log(`[ApiService] 🪟 Created Steam window with tab ID: ${tabId}`);

      return new Promise((resolve, reject) => {
        // Timeout de sécurité de 5 minutes pour l'assistance manuelle
        const timeout = setTimeout(() => {
          chrome.windows.remove(window.id);
          reject(new Error("Timeout while waiting for manual extraction"));
        }, 300000); // 5 minutes

        // Écouter les messages du content script
        const messageListener = (message, sender, sendResponse) => {
          if (
            sender.tab?.id === tabId &&
            message.type === "WISHLIST_EXTRACTION_COMPLETE"
          ) {
            console.log(`[ApiService] ✅ Manual extraction completed`);
            clearTimeout(timeout);
            chrome.runtime.onMessage.removeListener(messageListener);

            // Fermer la fenêtre
            chrome.windows.remove(window.id);

            if (message.success) {
              resolve(message.gameIds);
            } else {
              reject(new Error(message.error || "Manual extraction failed"));
            }
          }
        };

        chrome.runtime.onMessage.addListener(messageListener);

        // Injecter le script d'assistance manuelle une fois la page chargée
        chrome.tabs.onUpdated.addListener(function onUpdated(
          changedTabId,
          info
        ) {
          if (changedTabId === tabId && info.status === "complete") {
            chrome.tabs.onUpdated.removeListener(onUpdated);

            console.log(
              "[ApiService] 📝 Page loaded, injecting manual assistance script..."
            );

            setTimeout(() => {
              chrome.tabs.get(tabId, (tab) => {
                if (
                  (!tab.url.includes("steamcommunity.com") &&
                    !tab.url.includes("store.steampowered.com")) ||
                  !tab.url.includes("wishlist")
                ) {
                  console.error(`[ApiService] ❌ Wrong tab URL: ${tab.url}`);
                  clearTimeout(timeout);
                  chrome.runtime.onMessage.removeListener(messageListener);
                  chrome.windows.remove(window.id);
                  reject(new Error(`Wrong tab URL: ${tab.url}`));
                  return;
                }

                // Injecter le script d'assistance manuelle
                chrome.scripting
                  .executeScript({
                    target: { tabId: tabId },
                    function: extractWishlistWithManualAssistance,
                  })
                  .then(() => {
                    console.log(
                      "[ApiService] 🚀 Manual assistance script injected successfully"
                    );
                  })
                  .catch((error) => {
                    console.error(
                      "[ApiService] ❌ Script injection failed:",
                      error
                    );
                    clearTimeout(timeout);
                    chrome.runtime.onMessage.removeListener(messageListener);
                    chrome.windows.remove(window.id);
                    reject(error);
                  });
              });
            }, 2000);
          }
        });
      });
    } catch (error) {
      console.error("[ApiService] Error with manual scroll approach:", error);
      return null;
    }
  }

  // Nouvelle méthode pour parser le HTML de la wishlist Steam
  parseSteamWishlistHtml(html) {
    try {
      console.log("[ApiService] Searching for wishlist data in HTML...");

      // Pattern principal pour extraire les IDs des jeux de la wishlist
      const wishlistPattern = /data-rfd-draggable-id="WishlistItem-(\d+)-\d+"/g;
      const gameIds = [];
      let match;

      // Extraire tous les IDs de jeux
      while ((match = wishlistPattern.exec(html)) !== null) {
        const gameId = match[1];
        if (gameId && !gameIds.includes(gameId)) {
          gameIds.push(gameId);
        }
      }

      console.log(
        `[ApiService] Found ${gameIds.length} games in wishlist:`,
        gameIds
      );

      // Construire un objet de données de wishlist compatible avec l'ancien format
      const wishlistData = {};
      gameIds.forEach((id, index) => {
        wishlistData[id] = {
          appid: parseInt(id),
          position: index,
          added: Date.now(), // Valeur par défaut
        };
      });

      console.log(
        "[ApiService] Successfully extracted wishlist data using main pattern"
      );
      return wishlistData;
    } catch (error) {
      console.error("[ApiService] Failed to parse Steam wishlist HTML:", error);
      return {};
    }
  }

  async getGogWishlist(accessToken) {
    const url = ApiUrls.GOG.WISHLIST;

    try {
      const response = await this.getJson(url, {
        Authorization: `Bearer ${accessToken}`,
      });

      ValidationUtils.validateSchema(response, ValidationSchemas.GOG_WISHLIST);
      return response;
    } catch (error) {
      throw ErrorUtils.createError(
        ErrorTypes.VALIDATION_ERROR,
        "Invalid GOG wishlist data",
        error
      );
    }
  }

  async getGogGameId(steamAppId) {
    // Fallback to individual ID lookup if batch fails
    return this.getGogGameIds([steamAppId]).then((results) => {
      if (results && results.length > 0) {
        return results[0];
      }
      throw new Error(`No GOG game ID found for Steam app ${steamAppId}`);
    });
  }

  async getGogGameIds(steamAppIds) {
    const url = ApiUrls.NETLIFY.GAME_ID_BATCH;

    try {
      console.log(
        `[ApiService] Getting GOG game IDs for ${steamAppIds.length} Steam apps:`,
        steamAppIds
      );

      // Convert to numbers to match API expectation
      const steamAppIdsAsNumbers = steamAppIds.map((id) => parseInt(id, 10));

      const response = await this.post(url, steamAppIdsAsNumbers);
      const gogGameIds = await response.json();

      console.log(
        `[ApiService] Received ${gogGameIds.length} GOG game IDs:`,
        gogGameIds
      );

      if (!Array.isArray(gogGameIds)) {
        throw new Error("Invalid response format from Netlify function");
      }

      // Si l'API retourne un tableau vide ou de mauvaise taille, considérer cela comme un échec
      if (gogGameIds.length === 0 || gogGameIds.length !== steamAppIds.length) {
        console.warn(
          `[ApiService] API returned empty or incorrect size array. Expected ${steamAppIds.length}, got ${gogGameIds.length}`
        );
        throw new Error("API returned empty or incorrect response");
      }

      return gogGameIds;
    } catch (error) {
      console.warn(
        `[ApiService] Batch request failed, using fallback:`,
        error.message
      );

      // Fallback: essayer quelques correspondances manuelles connues ou retourner -1
      return this.getFallbackGogGameIds(steamAppIds);
    }
  }

  getFallbackGogGameIds(steamAppIds) {
    console.log("[ApiService] Using fallback manual matching...");

    // Correspondances manuelles pour quelques jeux populaires
    const manualMappings = {
      // Quelques correspondances connues (à compléter)
      105800: 1207659191, // Life is Strange
      210970: 1207659142, // The Witcher 3
      305620: 1207664593, // The Elder Scrolls V: Skyrim
      // ... autres correspondances
    };

    return steamAppIds.map((steamAppId) => {
      const gogId = manualMappings[steamAppId];
      if (gogId) {
        console.log(
          `[ApiService] Found manual mapping: Steam ${steamAppId} -> GOG ${gogId}`
        );
        return gogId;
      }
      return -1; // Pas de correspondance trouvée
    });
  }

  async addToGogWishlist(gameId, accessToken) {
    const url = ApiUrls.GOG.WISHLIST_ADD(gameId);

    try {
      await this.get(url, {
        Authorization: `Bearer ${accessToken}`,
      });
      return true;
    } catch (error) {
      throw ErrorUtils.createError(
        ErrorTypes.NETWORK_ERROR,
        `Failed to add game ${gameId} to GOG wishlist`,
        error
      );
    }
  }

  async refreshGogToken(refreshToken, clientId, clientSecret) {
    const url = ApiUrls.GOG.TOKEN_REFRESH;
    const params = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });

    try {
      const response = await this.get(`${url}?${params}`);
      const tokens = await response.json();

      ValidationUtils.validateSchema(tokens, ValidationSchemas.GOG_TOKEN);
      return tokens;
    } catch (error) {
      throw ErrorUtils.createError(
        ErrorTypes.AUTH_ERROR,
        "Failed to refresh GOG token",
        error
      );
    }
  }

  // Utilitaire pour extraire le texte d'un élément XML
  getXmlElementText(xmlDoc, tagName) {
    const element = xmlDoc.getElementsByTagName(tagName)[0];
    if (!element || !element.childNodes[0]) {
      throw new Error(`XML element '${tagName}' not found or empty`);
    }
    return element.childNodes[0].nodeValue;
  }

  // Méthode pour faire des requêtes avec retry automatique
  async requestWithRetry(url, options = {}, maxAttempts = 3) {
    return PromiseUtils.retry(
      () => this.makeRequest(url, options),
      maxAttempts,
      1000
    );
  }
}

// Fonction globale à injecter dans la page Steam pour extraire la wishlist complète
function extractWishlistWithManualAssistance() {
  console.log(
    "[WishlistExtractor] 🎮 Starting manual assistance for wishlist extraction..."
  );
  console.log("[WishlistExtractor] Current URL:", window.location.href);

  const gameIds = new Set();

  // Fonction pour extraire les IDs actuellement visibles
  function extractCurrentGameIds() {
    console.log("[WishlistExtractor] 🔍 Extracting current game IDs...");

    const elements = document.querySelectorAll(
      '[data-rfd-draggable-id^="WishlistItem-"]'
    );
    console.log(
      `[WishlistExtractor] Found ${elements.length} wishlist elements`
    );

    let newGamesFound = 0;

    elements.forEach((element, index) => {
      const dragId = element.getAttribute("data-rfd-draggable-id");
      const match = dragId.match(/WishlistItem-(\d+)-\d+/);
      if (match && match[1]) {
        const gameId = match[1];
        if (!gameIds.has(gameId)) {
          newGamesFound++;
          console.log(`[WishlistExtractor] New game found: ${gameId}`);
        }
        gameIds.add(gameId);
      }
    });

    console.log(
      `[WishlistExtractor] Found ${gameIds.size} games total (+${newGamesFound} new)`
    );
    return gameIds.size;
  }

  // Vérifier si on est bien sur une page de wishlist Steam
  const isSteamWishlist =
    (window.location.href.includes("steamcommunity.com") ||
      window.location.href.includes("store.steampowered.com")) &&
    window.location.href.includes("wishlist");

  if (!isSteamWishlist) {
    console.error("[WishlistExtractor] ❌ Not on a Steam wishlist page!");
    chrome.runtime.sendMessage({
      type: "WISHLIST_EXTRACTION_COMPLETE",
      success: false,
      error: "Not on Steam wishlist page",
      gameCount: 0,
    });
    return;
  }

  console.log(
    `[WishlistExtractor] ✅ Confirmed Steam wishlist page: ${window.location.href}`
  );

  // Extraire les jeux déjà visibles
  const initialGameCount = extractCurrentGameIds();
  console.log(
    `[WishlistExtractor] ✅ Initial games found: ${initialGameCount}`
  );

  // Créer un overlay d'instruction pour l'utilisateur
  const overlay = document.createElement("div");
  overlay.id = "wishlist-extraction-overlay";
  overlay.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: linear-gradient(135deg, #1e3c72, #2a5298);
    color: white;
    padding: 20px;
    border-radius: 12px;
    font-family: Arial, sans-serif;
    font-size: 14px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
    z-index: 10000;
    max-width: 350px;
    border: 2px solid #4a90e2;
  `;

  overlay.innerHTML = `
    <div style="display: flex; align-items: center; margin-bottom: 15px;">
      <div style="font-size: 20px; margin-right: 10px;">🎮</div>
      <div style="font-weight: bold; font-size: 16px;">Import Wishlist - Assistance manuelle</div>
    </div>
    <div style="margin-bottom: 15px; line-height: 1.4;">
      <strong>Jeux trouvés :</strong> <span id="game-count">${gameIds.size}</span><br>
      <strong>Mode :</strong> Scroll manuel uniquement
    </div>
    <div style="margin-bottom: 15px; padding: 10px; background: rgba(255,255,255,0.1); border-radius: 6px;">
      <strong>Instructions :</strong><br>
      1. Scrollez manuellement vers le bas pour charger plus de jeux<br>
      2. Les jeux sont détectés automatiquement<br>
      3. Cliquez sur "Terminer" quand vous avez vu tous vos jeux
    </div>
    <div style="text-align: center;">
      <button id="finish-extraction" style="background: #28a745; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; margin-right: 10px;">Terminer l'extraction</button>
      <button id="cancel-extraction" style="background: #dc3545; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer;">Annuler</button>
    </div>
  `;

  document.body.appendChild(overlay);

  // Observer les changements DOM pour détecter les nouveaux jeux
  let debounceTimer = null;
  const observer = new MutationObserver(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const newGameCount = extractCurrentGameIds();
      const gameCountElement = document.getElementById("game-count");
      if (gameCountElement) {
        gameCountElement.textContent = gameIds.size;
      }
      console.log(
        `[WishlistExtractor] 📊 Manual mode update: ${gameIds.size} games found`
      );
    }, 500);
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // Gestionnaires de boutons
  document.getElementById("finish-extraction").addEventListener("click", () => {
    observer.disconnect();
    overlay.remove();
    console.log(
      `[WishlistExtractor] 🎉 Manual extraction completed with ${gameIds.size} games`
    );

    chrome.runtime.sendMessage({
      type: "WISHLIST_EXTRACTION_COMPLETE",
      success: true,
      gameIds: Array.from(gameIds),
      gameCount: gameIds.size,
    });
  });

  document.getElementById("cancel-extraction").addEventListener("click", () => {
    observer.disconnect();
    overlay.remove();
    console.log(`[WishlistExtractor] ❌ Manual extraction cancelled`);

    chrome.runtime.sendMessage({
      type: "WISHLIST_EXTRACTION_COMPLETE",
      success: false,
      error: "Extraction cancelled by user",
      gameCount: gameIds.size,
    });
  });
}

// Exposer la classe dans le contexte global
self.ApiService = ApiService;
