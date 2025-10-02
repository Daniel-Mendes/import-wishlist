// import { MessageTypes, ImportStates } from "../shared/constants.js";
// import { ErrorUtils } from "../shared/utils.js";
// import { AuthService } from "./services/AuthService.js";
// import { WishlistService } from "./services/WishlistService.js";
// import { StorageService } from "./services/StorageService.js";
// import { ApiService } from "./services/ApiService.js";
// import { StateMachine } from "../shared/StateMachine.js";

class MessageHandler {
  constructor() {
    // Initialiser les services
    this.storageService = new StorageService();
    this.apiService = new ApiService();
    this.stateMachine = new StateMachine();
    this.authService = new AuthService(
      this.apiService,
      this.storageService,
      this.stateMachine
    );
    this.wishlistService = new WishlistService(
      this.apiService,
      this.storageService,
      this.stateMachine
    );

    // État global
    this.gogLoginSizes = null;
  }

  async handleMessage(message, sender, sendResponse) {
    try {
      switch (message.type) {
        // === AUTHENTIFICATION STEAM ===
        case MessageTypes.AUTH_STEAM_START:
          return await this.handleSteamAuthStart();

        // === AUTHENTIFICATION GOG ===
        case MessageTypes.AUTH_GOG_START:
          return await this.handleGogAuthStart();

        case MessageTypes.AUTH_GOG_TOKEN_EXTRACTED:
          return await this.handleGogTokenExtracted(message);

        case MessageTypes.AUTH_GOG_CODE_EXTRACTED:
          return await this.handleGogCodeExtracted(message);

        case MessageTypes.AUTH_GOG_TOKEN_REFRESH:
          return await this.handleGogTokenRefresh();

        // === WISHLISTS ===
        case MessageTypes.WISHLIST_STEAM_GET:
          return await this.handleGetSteamWishlist();

        case MessageTypes.WISHLIST_GOG_GET:
          return await this.handleGetGogWishlist();

        // === IMPORT ===
        case MessageTypes.IMPORT_START:
          return await this.handleImportStart(message);

        // === UI ===
        case MessageTypes.UI_SET_GOG_LOGIN_SIZES:
          return this.handleSetGogLoginSizes(message);

        case MessageTypes.STATE_GET:
          return await this.handleGetState();

        // === WISHLIST EXTRACTION ===
        case MessageTypes.WISHLIST_EXTRACTION_COMPLETE:
          return this.handleWishlistExtractionComplete(message);

        // === NAVIGATION EVENTS ===
        case "tabClosed":
          return this.handleTabClosed(message);

        default:
          ErrorUtils.logError(
            new Error(`Unknown message type: ${message.type}`),
            "MessageHandler.handleMessage"
          );
          return { success: false, error: "Unknown message type" };
      }
    } catch (error) {
      ErrorUtils.logError(
        error,
        `MessageHandler.handleMessage - ${message.type}`
      );

      // Envoyer une alerte d'erreur à l'UI
      this.sendUIAlert(
        "error",
        error.message || "An unexpected error occurred"
      );

      return { success: false, error: error.message };
    }
  }

  // === HANDLERS D'AUTHENTIFICATION ===

  async handleSteamAuthStart() {
    try {
      const result = await this.authService.authenticateSteam();

      // Envoyer une notification de succès
      this.sendMessage({
        type: MessageTypes.AUTH_STEAM_SUCCESS,
        steamUserId: result,
      });

      return { success: true, steamUserId: result };
    } catch (error) {
      this.sendMessage({
        type: MessageTypes.AUTH_STEAM_ERROR,
        error: error.message,
      });
      throw error;
    }
  }

  async handleGogAuthStart() {
    try {
      const result = await this.authService.authenticateGog();
      return { success: true, windowId: result.windowId };
    } catch (error) {
      this.sendMessage({
        type: MessageTypes.AUTH_GOG_ERROR,
        error: error.message,
      });
      throw error;
    }
  }

  async handleGogTokenExtracted(message) {
    try {
      const result = await this.authService.handleGogTokenExtraction(
        message.tokens
      );

      // Fermer l'onglet d'authentification si fourni
      if (message.tabId) {
        try {
          await chrome.tabs.remove(message.tabId);
        } catch (error) {
          ErrorUtils.logError(error, "Failed to close GOG auth tab");
        }
      }

      // Envoyer une notification de succès
      this.sendMessage({
        type: MessageTypes.AUTH_GOG_SUCCESS,
        gogAccessToken: result.gogAccessToken,
        gogUserId: result.gogUserId,
      });

      return { success: true, gogAccessToken: result.gogAccessToken };
    } catch (error) {
      this.sendMessage({
        type: MessageTypes.AUTH_GOG_ERROR,
        error: error.message,
      });
      throw error;
    }
  }

  async handleGogCodeExtracted(message) {
    try {
      console.log("[MessageHandler] Processing GOG authorization code");

      // Extraire les données du message
      const { authCode, origin, url, timestamp } = message;

      if (!authCode) {
        throw new Error("No authorization code provided");
      }

      console.log(
        "[MessageHandler] Authorization code received, exchanging for tokens..."
      );

      // Utiliser l'AuthService pour échanger le code contre des tokens
      const result = await this.authService.handleGogCodeExtraction(
        authCode,
        origin
      );

      // Fermer l'onglet d'authentification si fourni
      if (message.tabId) {
        try {
          await chrome.tabs.remove(message.tabId);
        } catch (error) {
          ErrorUtils.logError(error, "Failed to close GOG auth tab");
        }
      }

      // Envoyer une notification de succès
      this.sendMessage({
        type: MessageTypes.AUTH_GOG_SUCCESS,
        gogAccessToken: result.gogAccessToken,
        gogUserId: result.gogUserId,
        extractionMethod: "authorization_code",
      });

      return { success: true, gogAccessToken: result.gogAccessToken };
    } catch (error) {
      ErrorUtils.logError(error, "GOG code extraction failed");

      this.sendMessage({
        type: MessageTypes.AUTH_GOG_ERROR,
        error: error.message,
        extractionMethod: "authorization_code",
      });

      throw error;
    }
  }

  async handleGogTokenRefresh() {
    try {
      const result = await this.authService.refreshGogToken();

      this.sendMessage({
        type: MessageTypes.AUTH_GOG_TOKEN_REFRESHED,
        gogAccessToken: result.gogAccessToken,
      });

      return { success: true, gogAccessToken: result.gogAccessToken };
    } catch (error) {
      this.sendUIAlert(
        "error",
        "GOG authentication expired. Please sign in again."
      );
      throw error;
    }
  }

  // === HANDLERS DE WISHLIST ===

  async handleGetSteamWishlist() {
    try {
      const wishlist = await this.wishlistService.getSteamWishlist();

      // Envoyer le message pour notifier (si popup ouverte)
      this.sendMessage({
        type: MessageTypes.WISHLIST_STEAM_RECEIVED,
        steamWishlistCount: wishlist.count,
      });

      // Retourner aussi les données dans la réponse
      return { success: true, steamWishlistCount: wishlist.count };
    } catch (error) {
      console.error("[MessageHandler] Failed to get Steam wishlist:", error);
      this.sendUIAlert("error", "Failed to get Steam wishlist");
      throw error;
    }
  }

  async handleGetGogWishlist() {
    try {
      const wishlist = await this.wishlistService.getGogWishlist();

      // Envoyer le message pour notifier (si popup ouverte)
      this.sendMessage({
        type: MessageTypes.WISHLIST_GOG_RECEIVED,
        gogWishlistCount: wishlist.count,
      });

      // Retourner aussi les données dans la réponse
      return { success: true, gogWishlistCount: wishlist.count };
    } catch (error) {
      console.error("[MessageHandler] Failed to get GOG wishlist:", error);
      this.sendUIAlert("error", "Failed to get GOG wishlist");
      throw error;
    }
  }

  // === HANDLERS D'IMPORT ===

  async handleImportStart(message) {
    try {
      // Vérifier et restaurer l'état d'authentification depuis le storage
      await this.checkAndRestoreAuthState();

      // Debug de l'état d'authentification
      console.log("[MessageHandler] Import start requested");
      console.log(
        "[MessageHandler] Current auth state:",
        this.stateMachine.currentState
      );
      console.log(
        "[MessageHandler] Import state:",
        this.stateMachine.importState
      );
      console.log(
        "[MessageHandler] Is fully authenticated:",
        this.stateMachine.isFullyAuthenticated
      );
      console.log(
        "[MessageHandler] Is Steam authenticated:",
        this.stateMachine.isSteamAuthenticated
      );
      console.log(
        "[MessageHandler] Is GOG authenticated:",
        this.stateMachine.isGogAuthenticated
      );
      console.log(
        "[MessageHandler] Can start import:",
        this.stateMachine.canStartImport
      );

      // Vérifier l'état d'authentification avec une logique améliorée
      if (
        !this.stateMachine.isSteamAuthenticated ||
        !this.stateMachine.isGogAuthenticated
      ) {
        const missingAuth = [];
        if (!this.stateMachine.isSteamAuthenticated) missingAuth.push("Steam");
        if (!this.stateMachine.isGogAuthenticated) missingAuth.push("GOG");

        throw new Error(
          `Authentication required for: ${missingAuth.join(" and ")}`
        );
      }

      // Vérifier si on peut commencer l'import (état IDLE)
      if (this.stateMachine.importState !== ImportStates.IDLE) {
        console.log("[MessageHandler] Import state not IDLE, resetting...");
        if (this.stateMachine.importState === ImportStates.ERROR) {
          this.stateMachine.transitionImport("RESET");
        }
      }

      console.log("[MessageHandler] Starting import...");

      // Démarrer l'import avec callback de progression
      const result = await this.wishlistService.performFullImport(
        (progress) => {
          this.sendMessage({
            type: MessageTypes.IMPORT_PROGRESS,
            progress: progress,
          });
        }
      );

      // Envoyer le résultat final
      this.sendMessage({
        type: MessageTypes.IMPORT_SUCCESS,
        results: result.results,
        summary: result.summary,
      });

      return { success: true, results: result.results };
    } catch (error) {
      this.sendMessage({
        type: MessageTypes.IMPORT_ERROR,
        error: error.message,
      });
      throw error;
    }
  }

  // === MÉTHODES UTILITAIRES ===

  // Vérifier et restaurer l'état d'authentification depuis le storage
  async checkAndRestoreAuthState() {
    try {
      console.log("[MessageHandler] Checking stored authentication state...");

      const tokens = await this.storageService.getAuthTokens();
      console.log("[MessageHandler] Stored tokens:", {
        hasSteam: !!tokens.steam_user_id,
        hasGog: !!tokens.gog_access_token,
        steamUserId: tokens.steam_user_id,
        gogAccessToken: tokens.gog_access_token ? "present" : "missing",
      });

      // Mettre à jour l'état en fonction des tokens présents
      let authUpdated = false;

      if (tokens.steam_user_id && !this.stateMachine.isSteamAuthenticated) {
        console.log("[MessageHandler] Restoring Steam authentication state");
        this.stateMachine.transitionAuth("AUTH_STEAM", {
          steamUserId: tokens.steam_user_id,
        });
        authUpdated = true;
      }

      if (tokens.gog_access_token && !this.stateMachine.isGogAuthenticated) {
        console.log("[MessageHandler] Restoring GOG authentication state");
        // Si Steam est déjà authentifié, passer à FULLY_AUTHENTICATED
        if (this.stateMachine.isSteamAuthenticated) {
          this.stateMachine.transitionAuth("AUTH_GOG", {
            gogAccessToken: tokens.gog_access_token,
            gogUserId: tokens.gog_user_id || "unknown",
          });
        } else {
          this.stateMachine.transitionAuth("AUTH_GOG", {
            gogAccessToken: tokens.gog_access_token,
            gogUserId: tokens.gog_user_id || "unknown",
          });
        }
        authUpdated = true;
      }

      if (authUpdated) {
        console.log("[MessageHandler] Authentication state restored:", {
          currentState: this.stateMachine.currentState,
          isSteamAuth: this.stateMachine.isSteamAuthenticated,
          isGogAuth: this.stateMachine.isGogAuthenticated,
          isFullyAuth: this.stateMachine.isFullyAuthenticated,
        });
      }

      return authUpdated;
    } catch (error) {
      console.error("[MessageHandler] Error checking auth state:", error);
      return false;
    }
  }

  // === HANDLERS UI ===

  handleSetGogLoginSizes(message) {
    this.gogLoginSizes = message.gogLoginSizes;
    this.authService.setGogLoginSizes(this.gogLoginSizes);
    return { success: true };
  }

  async handleGetState() {
    try {
      const authStatus = await this.authService.getAuthStatus();
      const stateMachineState = this.stateMachine.getFullState();

      return {
        success: true,
        auth: authStatus,
        stateMachine: stateMachineState,
      };
    } catch (error) {
      throw error;
    }
  }

  handleTabClosed(message) {
    // Logique pour gérer la fermeture d'onglets (ex: onglets d'auth)
    return { success: true };
  }

  // === UTILITAIRES ===

  sendMessage(message) {
    try {
      chrome.runtime.sendMessage(message);
    } catch (error) {
      ErrorUtils.logError(error, "MessageHandler.sendMessage");
    }
  }

  sendUIAlert(status, message, timeout = 5000) {
    this.sendMessage({
      type: MessageTypes.UI_ALERT,
      status: status, // 'success', 'error', 'warning', 'info'
      message: message,
      timeout: timeout,
    });
  }

  // Méthode pour valider les messages entrants
  validateMessage(message) {
    if (!message || typeof message !== "object") {
      throw new Error("Invalid message format");
    }

    if (!message.type || !Object.values(MessageTypes).includes(message.type)) {
      throw new Error(`Invalid message type: ${message.type}`);
    }

    return true;
  }

  // === WISHLIST EXTRACTION ===

  handleWishlistExtractionComplete(message) {
    try {
      console.log("[MessageHandler] Wishlist extraction completed:", {
        success: message.success,
        gameCount: message.gameIds?.length || 0,
        error: message.error,
      });

      // Ce message est géré directement par ApiService via son listener
      // Nous le loggons ici pour le debugging mais n'avons pas besoin de le traiter
      return {
        success: true,
        message: "Wishlist extraction message acknowledged",
      };
    } catch (error) {
      ErrorUtils.logError(
        error,
        "MessageHandler.handleWishlistExtractionComplete"
      );
      return { success: false, error: error.message };
    }
  }

  // Méthode pour loguer les messages pour le debugging
  logMessage(message, direction = "incoming") {
    if (process.env.NODE_ENV === "development") {
      console.log(`[MessageHandler] ${direction}:`, message);
    }
  }
}

// Exposer la classe pour l'importation
self.MessageHandler = MessageHandler;
