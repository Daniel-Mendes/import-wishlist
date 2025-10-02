// import { ErrorUtils, ChromeUtils } from "../shared/utils.js";
// import { ErrorTypes } from "../shared/constants.js";

class StorageService {
  constructor() {
    this.cache = new Map();
  }

  async get(key) {
    try {
      // Vérifier le cache d'abord
      if (this.cache.has(key)) {
        return this.cache.get(key);
      }

      const result = await ChromeUtils.getFromStorage([key]);
      const value = result[key];

      // Mettre en cache pour les accès futurs
      if (value !== undefined) {
        this.cache.set(key, value);
      }

      return value;
    } catch (error) {
      throw ErrorUtils.createError(
        ErrorTypes.NETWORK_ERROR,
        `Failed to get ${key} from storage`,
        error
      );
    }
  }

  async set(key, value) {
    try {
      await ChromeUtils.setToStorage({ [key]: value });

      // Mettre à jour le cache
      this.cache.set(key, value);

      return true;
    } catch (error) {
      throw ErrorUtils.createError(
        ErrorTypes.NETWORK_ERROR,
        `Failed to set ${key} in storage`,
        error
      );
    }
  }

  async getMultiple(keys) {
    try {
      const result = await ChromeUtils.getFromStorage(keys);

      // Mettre à jour le cache pour tous les éléments récupérés
      Object.entries(result).forEach(([key, value]) => {
        if (value !== undefined) {
          this.cache.set(key, value);
        }
      });

      return result;
    } catch (error) {
      throw ErrorUtils.createError(
        ErrorTypes.NETWORK_ERROR,
        "Failed to get multiple values from storage",
        error
      );
    }
  }

  async setMultiple(data) {
    try {
      await ChromeUtils.setToStorage(data);

      // Mettre à jour le cache pour tous les éléments
      Object.entries(data).forEach(([key, value]) => {
        this.cache.set(key, value);
      });

      return true;
    } catch (error) {
      throw ErrorUtils.createError(
        ErrorTypes.NETWORK_ERROR,
        "Failed to set multiple values in storage",
        error
      );
    }
  }

  async remove(key) {
    try {
      await new Promise((resolve, reject) => {
        chrome.storage.local.remove([key], () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve();
          }
        });
      });

      // Supprimer du cache
      this.cache.delete(key);

      return true;
    } catch (error) {
      throw ErrorUtils.createError(
        ErrorTypes.NETWORK_ERROR,
        `Failed to remove ${key} from storage`,
        error
      );
    }
  }

  async clear() {
    try {
      await new Promise((resolve, reject) => {
        chrome.storage.local.clear(() => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve();
          }
        });
      });

      // Vider le cache
      this.cache.clear();

      return true;
    } catch (error) {
      throw ErrorUtils.createError(
        ErrorTypes.NETWORK_ERROR,
        "Failed to clear storage",
        error
      );
    }
  }

  // Méthodes spécialisées pour l'authentification
  async getAuthTokens() {
    return this.getMultiple([
      "steam_user_id",
      "gog_access_token",
      "gog_refresh_token",
      "gog_user_id",
    ]);
  }

  async setAuthTokens(tokens) {
    const validTokens = {};

    if (tokens.steamUserId) {
      validTokens.steam_user_id = tokens.steamUserId;
    }

    if (tokens.gogAccessToken) {
      validTokens.gog_access_token = tokens.gogAccessToken;
    }

    if (tokens.gogRefreshToken) {
      validTokens.gog_refresh_token = tokens.gogRefreshToken;
    }

    if (tokens.gogUserId) {
      validTokens.gog_user_id = tokens.gogUserId;
    }

    return this.setMultiple(validTokens);
  }

  async clearAuthData() {
    await Promise.all([
      this.remove("steam_user_id"),
      this.remove("gog_access_token"),
      this.remove("gog_refresh_token"),
      this.remove("gog_user_id"),
    ]);

    return true;
  }

  // Méthodes pour les données d'état
  async getAppState() {
    const defaultState = {
      auth: {
        steam: null,
        gog: null,
      },
      wishlist: {
        steam: [],
        gog: [],
      },
      ui: {
        loading: false,
        errors: [],
      },
      lastImport: null,
    };

    const savedState = await this.get("app_state");
    return savedState ? { ...defaultState, ...savedState } : defaultState;
  }

  async setAppState(state) {
    return this.set("app_state", state);
  }

  // Invalidation du cache pour forcer un refresh
  invalidateCache(key = null) {
    if (key) {
      this.cache.delete(key);
    } else {
      this.cache.clear();
    }
  }
}

// Exposer la classe dans le contexte global
self.StorageService = StorageService;
