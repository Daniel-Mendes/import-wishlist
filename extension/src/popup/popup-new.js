// import { MessageTypes, Config } from "../shared/constants.js";
// import {
//   ChromeUtils,
//   DomUtils,
//   ErrorUtils,
//   WindowUtils,
// } from "../shared/utils.js";

// Les dépendances sont chargées via les balises <script> dans popup.html
// Cela donne accès aux classes via le contexte global (self.*)

class PopupController {
  constructor() {
    this.alertTimeoutId = null;
    this.currentState = {
      auth: { steam: null, gog: null },
      ui: { loading: false, importing: false },
    };

    this.initialize();
  }

  async initialize() {
    try {
      // Configurer les tailles de fenêtre GOG
      this.setupGogLoginSizes();

      // Attacher les event listeners
      this.attachEventListeners();

      // Charger l'état initial
      await this.loadInitialState();

      // Écouter les messages du background
      this.setupMessageListener();
    } catch (error) {
      ErrorUtils.logError(error, "PopupController initialization");
      this.showAlert("error", "Failed to initialize popup", 5000);
    }
  }

  // === CONFIGURATION INITIALE ===

  setupGogLoginSizes() {
    const gogLoginSizes = WindowUtils.calculateCenterPosition(
      Config.GOG.LOGIN_WINDOW.WIDTH,
      Config.GOG.LOGIN_WINDOW.HEIGHT
    );

    ChromeUtils.sendMessage({
      type: MessageTypes.UI_SET_GOG_LOGIN_SIZES,
      gogLoginSizes: gogLoginSizes,
    }).catch((error) => {
      ErrorUtils.logError(error, "Failed to set GOG login sizes");
    });
  }

  attachEventListeners() {
    // Bouton de connexion Steam
    const steamLoginBtn = document.getElementById("btn-steam-login");
    if (steamLoginBtn) {
      steamLoginBtn.addEventListener("click", () => this.handleSteamLogin());
    }

    // Bouton de connexion GOG
    const gogLoginBtn = document.getElementById("btn-gog-login");
    if (gogLoginBtn) {
      gogLoginBtn.addEventListener("click", () => this.handleGogLogin());
    }

    // Bouton d'import
    const importBtn = document.getElementById("btn-import-wishlist");
    if (importBtn) {
      importBtn.addEventListener("click", () => this.handleImportWishlist());
    }
  }

  async loadInitialState() {
    try {
      // Vérifier si déjà authentifié
      const tokens = await ChromeUtils.getFromStorage([
        "steam_user_id",
        "gog_access_token",
      ]);

      if (tokens.steam_user_id) {
        await this.handleSteamAuthSuccess(tokens.steam_user_id);
      }

      if (tokens.gog_access_token) {
        // Demander un refresh du token GOG pour vérifier sa validité
        ChromeUtils.sendMessage({
          type: MessageTypes.AUTH_GOG_TOKEN_REFRESH,
        }).catch((error) => {
          ErrorUtils.logError(error, "Failed to refresh GOG token on startup");
        });
      }
    } catch (error) {
      ErrorUtils.logError(error, "Failed to load initial state");
    }
  }

  // === GESTION DES ÉVÉNEMENTS ===

  async handleSteamLogin() {
    try {
      this.setUIState({ loading: true });

      const result = await ChromeUtils.sendMessage({
        type: MessageTypes.AUTH_STEAM_START,
      });

      if (!result.success) {
        throw new Error(result.error || "Steam authentication failed");
      }
    } catch (error) {
      ErrorUtils.logError(error, "Steam login failed");
      this.showAlert("error", "Steam login failed: " + error.message, 5000);
    } finally {
      this.setUIState({ loading: false });
    }
  }

  async handleGogLogin() {
    try {
      this.setUIState({ loading: true });

      const result = await ChromeUtils.sendMessage({
        type: MessageTypes.AUTH_GOG_START,
      });

      if (!result.success) {
        throw new Error(result.error || "GOG authentication failed");
      }
    } catch (error) {
      ErrorUtils.logError(error, "GOG login failed");
      this.showAlert("error", "GOG login failed: " + error.message, 5000);
    } finally {
      this.setUIState({ loading: false });
    }
  }

  async handleImportWishlist() {
    try {
      // Vérifier l'authentification
      const tokens = await ChromeUtils.getFromStorage([
        "steam_user_id",
        "gog_access_token",
      ]);

      if (!tokens.steam_user_id) {
        this.showAlert(
          "error",
          chrome.i18n.getMessage("alertSteamNotSignIn"),
          5000
        );
        return;
      }

      if (!tokens.gog_access_token) {
        this.showAlert(
          "error",
          chrome.i18n.getMessage("alertGogNotSignIn"),
          5000
        );
        return;
      }

      // Démarrer l'import
      this.setUIState({ importing: true });
      this.setImportAnimation(true);

      const result = await ChromeUtils.sendMessage({
        type: MessageTypes.IMPORT_START,
      });

      if (!result.success) {
        throw new Error(result.error || "Import failed");
      }
    } catch (error) {
      ErrorUtils.logError(error, "Import failed");
      this.showAlert("error", "Import failed: " + error.message, 5000);
      this.setUIState({ importing: false });
      this.setImportAnimation(false);
    }
  }

  // === GESTION DES MESSAGES ===

  setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      try {
        this.handleIncomingMessage(message);
      } catch (error) {
        ErrorUtils.logError(error, "Error handling incoming message");
      }
    });
  }

  handleIncomingMessage(message) {
    switch (message.type) {
      case MessageTypes.AUTH_STEAM_SUCCESS:
        this.handleSteamAuthSuccess(message.steamUserId);
        this.showAlert(
          "success",
          chrome.i18n.getMessage("alertSteamSignIn"),
          5000
        );
        break;

      case MessageTypes.AUTH_GOG_SUCCESS:
        this.handleGogAuthSuccess(message.gogAccessToken);
        this.showAlert(
          "success",
          chrome.i18n.getMessage("alertGogSignIn"),
          5000
        );
        break;

      case MessageTypes.AUTH_GOG_TOKEN_REFRESHED:
        this.handleGogAuthSuccess(message.gogAccessToken);
        break;

      case MessageTypes.WISHLIST_STEAM_RECEIVED:
        this.updateSteamWishlistCount(message.steamWishlistCount);
        break;

      case MessageTypes.WISHLIST_GOG_RECEIVED:
        this.updateGogWishlistCount(message.gogWishlistCount);
        break;

      case MessageTypes.IMPORT_PROGRESS:
        this.handleImportProgress(message.progress);
        break;

      case MessageTypes.IMPORT_SUCCESS:
        this.handleImportSuccess(message.results);
        break;

      case MessageTypes.IMPORT_ERROR:
        this.handleImportError(message.error);
        break;

      case MessageTypes.UI_ALERT:
        this.showAlert(message.status, message.message, message.timeout);
        break;

      default:
        // Message non géré
        break;
    }
  }

  // === HANDLERS D'AUTHENTIFICATION ===

  async handleSteamAuthSuccess(steamUserId) {
    try {
      this.currentState.auth.steam = { userId: steamUserId };

      // Récupérer les détails du profil
      const profile = await this.fetchSteamProfile(steamUserId);

      // Mettre à jour l'UI
      this.updateSteamUI(profile);

      // Récupérer le nombre de jeux dans la wishlist
      ChromeUtils.sendMessage({
        type: MessageTypes.WISHLIST_STEAM_GET,
      })
        .then((response) => {
          if (
            response &&
            response.success &&
            typeof response.steamWishlistCount === "number"
          ) {
            this.updateSteamWishlistCount(response.steamWishlistCount);
          }
        })
        .catch((error) => {
          ErrorUtils.logError(error, "Failed to get Steam wishlist count");
        });
    } catch (error) {
      ErrorUtils.logError(error, "Failed to handle Steam auth success");
    }
  }

  async handleGogAuthSuccess(gogAccessToken) {
    try {
      this.currentState.auth.gog = { accessToken: gogAccessToken };

      // Récupérer les détails du profil
      const profile = await this.fetchGogProfile(gogAccessToken);

      // Mettre à jour l'UI
      this.updateGogUI(profile);

      // Récupérer le nombre de jeux dans la wishlist
      ChromeUtils.sendMessage({
        type: MessageTypes.WISHLIST_GOG_GET,
      })
        .then((response) => {
          if (
            response &&
            response.success &&
            typeof response.gogWishlistCount === "number"
          ) {
            this.updateGogWishlistCount(response.gogWishlistCount);
          }
        })
        .catch((error) => {
          ErrorUtils.logError(error, "Failed to get GOG wishlist count");
        });
    } catch (error) {
      ErrorUtils.logError(error, "Failed to handle GOG auth success");
    }
  }

  // === HANDLERS D'IMPORT ===

  handleImportProgress(progress) {
    // Afficher le progrès de l'import
    const percentage = progress.percentage || 0;
    const message = progress.message || `Import en cours... ${percentage}%`;

    // Ici on pourrait afficher une barre de progression
    console.log(`[Import Progress] ${percentage}% - ${message}`);
  }

  handleImportSuccess(results) {
    this.setUIState({ importing: false });
    this.setImportAnimation(false);

    const message = `${chrome.i18n.getMessage(
      "alertWishlistImportedGamesAdded"
    )}: ${results.added}
${chrome.i18n.getMessage("alertWishlistImportedGamesNotFound")}: ${
      results.notFound
    }
${chrome.i18n.getMessage("alertWishlistImportedGamesAlreadyInWishlist")}: ${
      results.alreadyInWishlist
    }`;

    this.showAlert("success", message, 10000);
  }

  handleImportError(error) {
    this.setUIState({ importing: false });
    this.setImportAnimation(false);

    this.showAlert("error", `Import failed: ${error}`, 5000);
  }

  // === RÉCUPÉRATION DES PROFILS ===

  async fetchSteamProfile(steamUserId) {
    try {
      const response = await fetch(
        `https://steamcommunity.com/profiles/${steamUserId}/?xml=1`
      );
      const text = await response.text();
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(text, "text/xml");

      return {
        steamID:
          xmlDoc.getElementsByTagName("steamID")[0]?.childNodes[0]?.nodeValue ||
          "Unknown",
        avatarFull:
          xmlDoc.getElementsByTagName("avatarFull")[0]?.childNodes[0]
            ?.nodeValue || "",
        customURL:
          xmlDoc.getElementsByTagName("customURL")[0]?.childNodes[0]
            ?.nodeValue || steamUserId,
      };
    } catch (error) {
      ErrorUtils.logError(error, "Failed to fetch Steam profile");
      return { steamID: "Unknown", avatarFull: "", customURL: steamUserId };
    }
  }

  async fetchGogProfile(accessToken) {
    try {
      const response = await fetch("https://menu.gog.com/v1/account/basic", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      ErrorUtils.logError(error, "Failed to fetch GOG profile");
      return { username: "Unknown", avatars: { menu_user_av_big2: "" } };
    }
  }

  // === MISE À JOUR DE L'UI ===

  updateSteamUI(profile) {
    try {
      DomUtils.safeSetTextContent(
        "title-steam",
        chrome.i18n.getMessage("titleSteamAccount")
      );
      DomUtils.safeToggleDisplay("btn-steam-login", false);
      DomUtils.safeSetAttribute("steam-avatar", "src", profile.avatarFull);
      DomUtils.safeSetTextContent("steam-name", profile.steamID);
      DomUtils.safeSetAttribute(
        "steam-name",
        "href",
        `https://store.steampowered.com/wishlist/id/${profile.customURL}`
      );
      DomUtils.safeToggleDisplay("details-steam", true);
    } catch (error) {
      ErrorUtils.logError(error, "Failed to update Steam UI");
    }
  }

  updateGogUI(profile) {
    try {
      DomUtils.safeSetTextContent(
        "title-gog",
        chrome.i18n.getMessage("titleGogAccount")
      );
      DomUtils.safeToggleDisplay("btn-gog-login", false);
      DomUtils.safeSetAttribute(
        "gog-avatar",
        "src",
        profile.avatars?.menu_user_av_big2 || ""
      );
      DomUtils.safeSetTextContent("gog-name", profile.username);
      DomUtils.safeSetAttribute(
        "gog-name",
        "href",
        `https://www.gog.com/u/${profile.username}/wishlist`
      );
      DomUtils.safeToggleDisplay("details-gog", true);
    } catch (error) {
      ErrorUtils.logError(error, "Failed to update GOG UI");
    }
  }

  updateSteamWishlistCount(count) {
    try {
      // Mettre à jour le texte du compteur
      const countElement = document.querySelector("#steam-wishlist-count span");
      if (countElement) {
        countElement.textContent = count;
      }

      // Afficher le conteneur de la wishlist
      const containerElement = document.querySelector(
        "#container-steam .container-wishlist"
      );
      if (containerElement) {
        containerElement.style.display = "block";
      }
    } catch (error) {
      ErrorUtils.logError(error, "Failed to update Steam wishlist count");
    }
  }

  updateGogWishlistCount(count) {
    try {
      // Mettre à jour le texte du compteur
      const countElement = document.querySelector("#gog-wishlist-count span");
      if (countElement) {
        countElement.textContent = count;
      }

      // Afficher le conteneur de la wishlist
      const containerElement = document.querySelector(
        "#container-gog .container-wishlist"
      );
      if (containerElement) {
        containerElement.style.display = "block";
      }
    } catch (error) {
      ErrorUtils.logError(error, "Failed to update GOG wishlist count");
    }
  }

  // === GESTION DE L'UI ===

  setUIState(newState) {
    this.currentState.ui = { ...this.currentState.ui, ...newState };
  }

  setImportAnimation(show) {
    try {
      const rotateIcon = document.getElementById("icon-rotate");
      if (rotateIcon) {
        if (show) {
          rotateIcon.classList.add("icon-spin");
        } else {
          rotateIcon.classList.remove("icon-spin");
        }
      }
    } catch (error) {
      ErrorUtils.logError(error, "Failed to set import animation");
    }
  }

  showAlert(status, message, timeout) {
    try {
      clearTimeout(this.alertTimeoutId);

      const alert = document.getElementById("alert");
      if (!alert) return;

      alert.classList.remove("success", "error", "warning", "info");
      alert.textContent = message;
      alert.classList.add(status);
      alert.style.display = "block";

      this.alertTimeoutId = setTimeout(() => {
        alert.style.display = "none";
        alert.classList.remove(status);
      }, timeout);
    } catch (error) {
      ErrorUtils.logError(error, "Failed to show alert");
    }
  }
}

// Initialiser le contrôleur quand le DOM est chargé
document.addEventListener("DOMContentLoaded", () => {
  new PopupController();
});
