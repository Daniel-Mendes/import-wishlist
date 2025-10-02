// import { ApiService } from "./ApiService.js";
// import { StorageService } from "./StorageService.js";
// import { StateMachine } from "../shared/StateMachine.js";
// import { ErrorUtils, WindowUtils } from "../shared/utils.js";
// import { ErrorTypes, Config } from "../shared/constants.js";

class AuthService {
  constructor(apiService, storageService, stateMachine) {
    this.apiService = apiService || new ApiService();
    this.storageService = storageService || new StorageService();
    this.stateMachine = stateMachine || new StateMachine();

    // Configuration des fenêtres de login (calculée à la demande)
    this.gogLoginConfig = {
      width: Config.GOG.LOGIN_WINDOW.WIDTH,
      height: Config.GOG.LOGIN_WINDOW.HEIGHT,
    };
  }

  // === AUTHENTIFICATION STEAM ===

  async authenticateSteam() {
    try {
      if (!chrome.identity) {
        throw new Error("Chrome identity API not available");
      }

      const extensionRedirectURL = chrome.identity.getRedirectURL();

      const steamOpenIDParams = {
        "openid.ns": "http://specs.openid.net/auth/2.0",
        "openid.mode": "checkid_setup",
        "openid.return_to": extensionRedirectURL,
        "openid.realm": extensionRedirectURL,
        "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
        "openid.claimed_id":
          "http://specs.openid.net/auth/2.0/identifier_select",
      };

      const authUrl = `${ApiUrls.STEAM.LOGIN}?${new URLSearchParams(
        steamOpenIDParams
      )}`;

      return new Promise((resolve, reject) => {
        chrome.identity.launchWebAuthFlow(
          {
            url: authUrl,
            interactive: true,
          },
          (responseUrl) => {
            if (chrome.runtime.lastError) {
              reject(
                ErrorUtils.createError(
                  ErrorTypes.AUTH_ERROR,
                  "Steam authentication failed",
                  chrome.runtime.lastError
                )
              );
              return;
            }

            try {
              // Vérifier d'abord s'il y a une erreur OpenID
              const url = new URL(responseUrl);
              const openidMode = url.searchParams.get("openid.mode");
              const openidError = url.searchParams.get("openid.error");

              if (openidMode === "error") {
                throw new Error(
                  `Steam OpenID error: ${openidError || "Unknown error"}`
                );
              }

              const steamUserId = this.extractSteamUserIdFromUrl(responseUrl);
              this.handleSteamAuthSuccess(steamUserId);
              resolve(steamUserId);
            } catch (error) {
              reject(error);
            }
          }
        );
      });
    } catch (error) {
      throw ErrorUtils.createError(
        ErrorTypes.AUTH_ERROR,
        "Failed to start Steam authentication",
        error
      );
    }
  }

  extractSteamUserIdFromUrl(url) {
    try {
      const urlParams = new URLSearchParams(new URL(url).search);
      const identity = urlParams.get("openid.identity");

      if (!identity) {
        throw new Error("No identity found in response URL");
      }

      // Supporter différents formats d'URL Steam
      // Format: https://steamcommunity.com/openid/id/76561198123456789
      const match =
        identity.match(/\/openid\/id\/(\d+)$/) ||
        identity.match(/\/id\/(\d+)$/);

      if (!match) {
        throw new Error(`Invalid identity format: ${identity}`);
      }

      return match[1];
    } catch (error) {
      throw ErrorUtils.createError(
        ErrorTypes.VALIDATION_ERROR,
        "Failed to extract Steam user ID from response",
        error
      );
    }
  }

  async handleSteamAuthSuccess(steamUserId) {
    try {
      // Stocker l'ID utilisateur Steam
      await this.storageService.setAuthTokens({ steamUserId });

      // Mettre à jour la state machine
      this.stateMachine.transitionAuth("AUTH_STEAM", { steamUserId });

      return { success: true, steamUserId };
    } catch (error) {
      throw ErrorUtils.createError(
        ErrorTypes.AUTH_ERROR,
        "Failed to handle Steam authentication success",
        error
      );
    }
  }

  // === AUTHENTIFICATION GOG ===

  async authenticateGog() {
    try {
      const windowPosition = WindowUtils.calculateCenterPosition(
        this.gogLoginConfig.width,
        this.gogLoginConfig.height
      );

      const authWindow = await chrome.windows.create({
        url: ApiUrls.GOG.LOGIN,
        type: "popup",
        ...windowPosition,
      });

      return { success: true, windowId: authWindow.id };
    } catch (error) {
      throw ErrorUtils.createError(
        ErrorTypes.AUTH_ERROR,
        "Failed to start GOG authentication",
        error
      );
    }
  }

  async handleGogTokenExtraction(tokens) {
    try {
      // Valider les tokens
      if (!tokens.access_token || !tokens.refresh_token || !tokens.user_id) {
        throw new Error("Invalid token data received");
      }

      // Stocker les tokens
      await this.storageService.setAuthTokens({
        gogAccessToken: tokens.access_token,
        gogRefreshToken: tokens.refresh_token,
        gogUserId: tokens.user_id,
      });

      // Mettre à jour la state machine
      this.stateMachine.transitionAuth("AUTH_GOG", {
        gogUserId: tokens.user_id,
        gogAccessToken: tokens.access_token,
      });

      return {
        success: true,
        gogAccessToken: tokens.access_token,
        gogUserId: tokens.user_id,
      };
    } catch (error) {
      throw ErrorUtils.createError(
        ErrorTypes.AUTH_ERROR,
        "Failed to handle GOG token extraction",
        error
      );
    }
  }

  async handleGogCodeExtraction(authCode, origin = "client") {
    try {
      console.log("[AuthService] Exchanging authorization code for tokens");

      if (!authCode) {
        throw new Error("Authorization code is required");
      }

      // Échanger le code d'autorisation contre des tokens d'accès
      const tokenResponse = await this.exchangeGogAuthCode(authCode, origin);

      if (!tokenResponse.access_token || !tokenResponse.refresh_token) {
        throw new Error("Invalid token response from GOG");
      }

      // Stocker les tokens
      await this.storageService.setAuthTokens({
        gogAccessToken: tokenResponse.access_token,
        gogRefreshToken: tokenResponse.refresh_token,
        gogUserId: tokenResponse.user_id || "unknown",
      });

      // Mettre à jour la state machine
      this.stateMachine.transitionAuth("AUTH_GOG", {
        gogUserId: tokenResponse.user_id || "unknown",
        gogAccessToken: tokenResponse.access_token,
      });

      console.log("[AuthService] GOG authentication completed successfully");

      return {
        success: true,
        gogAccessToken: tokenResponse.access_token,
        gogUserId: tokenResponse.user_id || "unknown",
      };
    } catch (error) {
      throw ErrorUtils.createError(
        ErrorTypes.AUTH_ERROR,
        "Failed to exchange GOG authorization code",
        error
      );
    }
  }

  async refreshGogToken() {
    try {
      const tokens = await this.storageService.getAuthTokens();

      if (!tokens.gog_refresh_token) {
        throw new Error("No refresh token available");
      }

      const refreshedTokens = await this.apiService.refreshGogToken(
        tokens.gog_refresh_token,
        Config.GOG.CLIENT_ID,
        Config.GOG.CLIENT_SECRET
      );

      // Mettre à jour le stockage
      await this.storageService.setAuthTokens({
        gogAccessToken: refreshedTokens.access_token,
        gogRefreshToken: refreshedTokens.refresh_token,
      });

      return {
        success: true,
        gogAccessToken: refreshedTokens.access_token,
      };
    } catch (error) {
      // Si le refresh échoue, déconnecter GOG
      await this.logoutGog();

      throw ErrorUtils.createError(
        ErrorTypes.AUTH_ERROR,
        "Failed to refresh GOG token",
        error
      );
    }
  }

  // === DÉCONNEXION ===

  async logoutSteam() {
    try {
      await this.storageService.remove("steam_user_id");

      if (this.stateMachine.isGogAuthenticated) {
        this.stateMachine.transitionAuth("LOGOUT_STEAM");
      } else {
        this.stateMachine.transitionAuth("LOGOUT_ALL");
      }

      return { success: true };
    } catch (error) {
      throw ErrorUtils.createError(
        ErrorTypes.AUTH_ERROR,
        "Failed to logout from Steam",
        error
      );
    }
  }

  async logoutGog() {
    try {
      await Promise.all([
        this.storageService.remove("gog_access_token"),
        this.storageService.remove("gog_refresh_token"),
        this.storageService.remove("gog_user_id"),
      ]);

      if (this.stateMachine.isSteamAuthenticated) {
        this.stateMachine.transitionAuth("LOGOUT_GOG");
      } else {
        this.stateMachine.transitionAuth("LOGOUT_ALL");
      }

      return { success: true };
    } catch (error) {
      throw ErrorUtils.createError(
        ErrorTypes.AUTH_ERROR,
        "Failed to logout from GOG",
        error
      );
    }
  }

  async logoutAll() {
    try {
      await this.storageService.clearAuthData();
      this.stateMachine.transitionAuth("LOGOUT_ALL");

      return { success: true };
    } catch (error) {
      throw ErrorUtils.createError(
        ErrorTypes.AUTH_ERROR,
        "Failed to logout from all services",
        error
      );
    }
  }

  // === ÉTAT D'AUTHENTIFICATION ===

  async getAuthStatus() {
    try {
      const tokens = await this.storageService.getAuthTokens();

      const status = {
        steam: {
          authenticated: !!tokens.steam_user_id,
          userId: tokens.steam_user_id || null,
        },
        gog: {
          authenticated: !!tokens.gog_access_token,
          userId: tokens.gog_user_id || null,
          hasRefreshToken: !!tokens.gog_refresh_token,
        },
        stateMachine: this.stateMachine.getFullState(),
      };

      // Synchroniser la state machine avec l'état stocké
      await this.syncStateMachineWithStorage(tokens);

      return status;
    } catch (error) {
      throw ErrorUtils.createError(
        ErrorTypes.AUTH_ERROR,
        "Failed to get authentication status",
        error
      );
    }
  }

  async syncStateMachineWithStorage(tokens) {
    try {
      const hasSteam = !!tokens.steam_user_id;
      const hasGog = !!tokens.gog_access_token;

      let targetState;
      if (hasSteam && hasGog) {
        targetState = "FULLY_AUTHENTICATED";
      } else if (hasSteam) {
        targetState = "STEAM_AUTHENTICATED";
      } else if (hasGog) {
        targetState = "GOG_AUTHENTICATED";
      } else {
        targetState = "UNAUTHENTICATED";
      }

      if (this.stateMachine.authState !== targetState) {
        this.stateMachine.forceAuthState(targetState, "sync_with_storage");
      }
    } catch (error) {
      ErrorUtils.logError(error, "AuthService.syncStateMachineWithStorage");
    }
  }

  // === UTILITAIRES ===

  setGogLoginSizes(sizes) {
    this.gogLoginConfig = { ...this.gogLoginConfig, ...sizes };
  }

  async validateAuthenticationState() {
    try {
      const tokens = await this.storageService.getAuthTokens();

      // Vérifier si les tokens GOG sont toujours valides
      if (tokens.gog_access_token) {
        try {
          await this.apiService.getGogProfile(tokens.gog_access_token);
        } catch (error) {
          // Si le token n'est plus valide, essayer de le rafraîchir
          if (tokens.gog_refresh_token) {
            await this.refreshGogToken();
          } else {
            await this.logoutGog();
          }
        }
      }

      return this.getAuthStatus();
    } catch (error) {
      throw ErrorUtils.createError(
        ErrorTypes.AUTH_ERROR,
        "Failed to validate authentication state",
        error
      );
    }
  }

  async exchangeGogAuthCode(authCode, origin = "client") {
    try {
      console.log("[AuthService] Making token exchange request to GOG");
      console.log("[AuthService] Auth code length:", authCode.length);
      console.log(
        "[AuthService] Auth code (first 50 chars):",
        authCode.substring(0, 50) + "..."
      );

      // Le code d'autorisation contient peut-être des caractères qui doivent être encodés
      const encodedAuthCode = encodeURIComponent(authCode);

      console.log(
        "[AuthService] Encoded auth code length:",
        encodedAuthCode.length
      );

      // Essayer l'endpoint principal GOG auth avec les bons paramètres
      const authTokenUrl = "https://auth.gog.com/token";

      const requestBody = new URLSearchParams({
        grant_type: "authorization_code",
        code: encodedAuthCode,
        redirect_uri: "https://embed.gog.com/on_login_success?origin=client",
        client_id: "46899977096215655",
        client_secret:
          "9d85c43b1482497dbbce61f6e4aa173a433796eeae2ca8c5f6129f2dc4de46d9", // Ajouter le client secret
      });

      console.log("[AuthService] Request body:", {
        grant_type: "authorization_code",
        code: encodedAuthCode.substring(0, 50) + "...",
        redirect_uri: "https://embed.gog.com/on_login_success?origin=client",
        client_id: "46899977096215655",
        client_secret:
          "9d85c43b1482497dbbce61f6e4aa173a433796eeae2ca8c5f6129f2dc4de46d9".substring(
            0,
            20
          ) + "...",
      });

      console.log("[AuthService] Making request to:", authTokenUrl);

      let response = await fetch(authTokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          "User-Agent": "Chrome Extension Import Wishlist",
        },
        body: requestBody,
      });

      console.log("[AuthService] Response status:", response.status);
      console.log(
        "[AuthService] Response headers:",
        Object.fromEntries(response.headers.entries())
      );

      // Si l'endpoint principal échoue, essayer l'endpoint embed
      if (!response.ok) {
        const errorText = await response.text();
        console.log("[AuthService] Main endpoint failed, response:", errorText);
        console.log("[AuthService] Trying embed endpoint as fallback...");

        const embedTokenUrl = "https://embed.gog.com/token";

        // Pour l'endpoint embed, essayer sans client_secret
        const embedRequestBody = new URLSearchParams({
          grant_type: "authorization_code",
          code: encodedAuthCode,
          redirect_uri: "https://embed.gog.com/on_login_success?origin=client",
          client_id: "46899977096215655",
        });

        response = await fetch(embedTokenUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
            "User-Agent": "Chrome Extension Import Wishlist",
          },
          body: embedRequestBody,
        });

        console.log(
          "[AuthService] Embed endpoint response status:",
          response.status
        );
      }

      if (!response.ok) {
        const errorText = await response.text();
        console.error(
          "[AuthService] Both endpoints failed. Final response:",
          errorText
        );

        // Logging détaillé pour debugging
        console.error("[AuthService] Debug info:", {
          authCodeLength: authCode.length,
          encodedAuthCodeLength: encodedAuthCode.length,
          authCodeStart: authCode.substring(0, 30) + "...",
          clientId: "46899977096215655",
          redirectUri: "https://embed.gog.com/on_login_success?origin=client",
          responseStatus: response.status,
          responseStatusText: response.statusText,
        });

        throw new Error(
          `GOG token exchange failed: ${response.status} ${response.statusText} - ${errorText}`
        );
      }

      const tokenData = await response.json();

      console.log("[AuthService] Token exchange successful!");
      console.log("[AuthService] Token data keys:", Object.keys(tokenData));

      // Vérifier que nous avons les tokens nécessaires
      if (!tokenData.access_token) {
        console.error("[AuthService] No access_token in response:", tokenData);
        throw new Error("No access_token received from GOG");
      }

      // La réponse devrait contenir access_token, refresh_token, etc.
      return {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        user_id: tokenData.user_id || tokenData.sub || "unknown",
        token_type: tokenData.token_type || "Bearer",
        expires_in: tokenData.expires_in,
      };
    } catch (error) {
      console.error("[AuthService] Token exchange failed:", error);
      throw ErrorUtils.createError(
        ErrorTypes.AUTH_ERROR,
        "Failed to exchange authorization code for tokens",
        error
      );
    }
  }
}

// Exposer la classe dans le contexte global
self.AuthService = AuthService;
