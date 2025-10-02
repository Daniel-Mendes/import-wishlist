// Message Types pour la communication entre scripts
const MessageTypes = {
  // Authentification Steam
  AUTH_STEAM_START: "AUTH_STEAM_START",
  AUTH_STEAM_SUCCESS: "AUTH_STEAM_SUCCESS",
  AUTH_STEAM_ERROR: "AUTH_STEAM_ERROR",

  // Authentification GOG
  AUTH_GOG_START: "AUTH_GOG_START",
  AUTH_GOG_SUCCESS: "AUTH_GOG_SUCCESS",
  AUTH_GOG_ERROR: "AUTH_GOG_ERROR",
  AUTH_GOG_TOKEN_EXTRACTED: "AUTH_GOG_TOKEN_EXTRACTED",
  AUTH_GOG_CODE_EXTRACTED: "AUTH_GOG_CODE_EXTRACTED",
  AUTH_GOG_TOKEN_REFRESH: "AUTH_GOG_TOKEN_REFRESH",
  AUTH_GOG_TOKEN_REFRESHED: "AUTH_GOG_TOKEN_REFRESHED",

  // Gestion des wishlists
  WISHLIST_STEAM_GET: "WISHLIST_STEAM_GET",
  WISHLIST_STEAM_RECEIVED: "WISHLIST_STEAM_RECEIVED",
  WISHLIST_GOG_GET: "WISHLIST_GOG_GET",
  WISHLIST_GOG_RECEIVED: "WISHLIST_GOG_RECEIVED",
  WISHLIST_EXTRACTION_COMPLETE: "WISHLIST_EXTRACTION_COMPLETE",

  // Import
  IMPORT_START: "IMPORT_START",
  IMPORT_PROGRESS: "IMPORT_PROGRESS",
  IMPORT_SUCCESS: "IMPORT_SUCCESS",
  IMPORT_ERROR: "IMPORT_ERROR",

  // UI
  UI_ALERT: "UI_ALERT",
  UI_STATE_CHANGE: "UI_STATE_CHANGE",
  UI_SET_GOG_LOGIN_SIZES: "UI_SET_GOG_LOGIN_SIZES",

  // État
  STATE_GET: "STATE_GET",
  STATE_SET: "STATE_SET",
};

// États d'authentification
const AuthStates = {
  UNAUTHENTICATED: "UNAUTHENTICATED",
  STEAM_AUTHENTICATED: "STEAM_AUTHENTICATED",
  GOG_AUTHENTICATED: "GOG_AUTHENTICATED",
  FULLY_AUTHENTICATED: "FULLY_AUTHENTICATED",
};

// États d'import
const ImportStates = {
  IDLE: "IDLE",
  FETCHING_STEAM: "FETCHING_STEAM",
  MATCHING_GAMES: "MATCHING_GAMES",
  IMPORTING_TO_GOG: "IMPORTING_TO_GOG",
  COMPLETED: "COMPLETED",
  ERROR: "ERROR",
};

// Constantes API
const ApiUrls = {
  STEAM: {
    LOGIN: "https://steamcommunity.com/openid/login",
    PROFILE: (userId) => `https://steamcommunity.com/profiles/${userId}/?xml=1`,
    WISHLIST: (userId) =>
      `https://steamcommunity.com/profiles/${userId}/wishlist/`,
  },
  GOG: {
    LOGIN:
      "https://login.gog.com/auth?client_id=46899977096215655&redirect_uri=https%3A%2F%2Fembed.gog.com%2Fon_login_success%3Forigin%3Dclient&response_type=code&layout=client2",
    TOKEN_REFRESH: "https://auth.gog.com/token",
    PROFILE: "https://menu.gog.com/v1/account/basic",
    WISHLIST: "https://embed.gog.com/user/wishlist.json",
    WISHLIST_ADD: (gameId) =>
      `https://embed.gog.com/user/wishlist/add/${gameId}`,
  },
  NETLIFY: {
    GAME_ID: (steamAppId) =>
      `https://import-wishlist.netlify.app/.netlify/functions/get-gog-game-id?steamAppId=${steamAppId}`,
    GAME_ID_BATCH:
      "https://import-wishlist.netlify.app/.netlify/functions/get-gog-game-id",
  },
};

// Configuration
const Config = {
  GOG: {
    CLIENT_ID: "46899977096215655",
    CLIENT_SECRET:
      "9d85c43b1482497dbbce61f6e4aa173a433796eeae2ca8c5f6129f2dc4de46d9",
    LOGIN_WINDOW: {
      WIDTH: 393,
      HEIGHT: 500,
    },
  },
  WISHLIST: {
    COUNT_PER_REQUEST: 50,
  },
  UI: {
    ALERT_TIMEOUT: 5000,
    IMPORT_ALERT_TIMEOUT: 10000,
  },
};

// Types d'erreur
const ErrorTypes = {
  NETWORK_ERROR: "NETWORK_ERROR",
  AUTH_ERROR: "AUTH_ERROR",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  SECURITY_ERROR: "SECURITY_ERROR",
  IMPORT_ERROR: "IMPORT_ERROR",
};

// Schémas de validation pour les réponses API
const ValidationSchemas = {
  STEAM_PROFILE: {
    required: ["steamID", "avatarFull", "customURL"],
  },
  GOG_PROFILE: {
    required: ["username", "avatars"],
  },
  GOG_TOKEN: {
    required: ["access_token", "refresh_token", "user_id"],
  },
  STEAM_WISHLIST: {
    type: "object",
  },
  GOG_WISHLIST: {
    required: ["wishlist"],
  },
};

// Exposer les constantes pour l'importation
self.MessageTypes = MessageTypes;
self.AuthStates = AuthStates;
self.ImportStates = ImportStates;
self.ApiUrls = ApiUrls;
self.Config = Config;
self.ErrorTypes = ErrorTypes;
self.ValidationSchemas = ValidationSchemas;
