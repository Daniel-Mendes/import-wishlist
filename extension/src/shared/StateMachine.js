// import { AuthStates, ImportStates } from "./constants.js";
// import { ErrorUtils } from "./utils.js";

class StateMachine {
  constructor(initialState = AuthStates.UNAUTHENTICATED) {
    this.currentState = initialState;
    this._importState = ImportStates.IDLE;
    this.subscribers = new Set();
    this.history = [];

    // Définition des transitions d'authentification valides
    this.authTransitions = {
      [AuthStates.UNAUTHENTICATED]: {
        AUTH_STEAM: AuthStates.STEAM_AUTHENTICATED,
        AUTH_GOG: AuthStates.GOG_AUTHENTICATED,
      },
      [AuthStates.STEAM_AUTHENTICATED]: {
        AUTH_GOG: AuthStates.FULLY_AUTHENTICATED,
        LOGOUT_STEAM: AuthStates.UNAUTHENTICATED,
        LOGOUT_ALL: AuthStates.UNAUTHENTICATED,
      },
      [AuthStates.GOG_AUTHENTICATED]: {
        AUTH_STEAM: AuthStates.FULLY_AUTHENTICATED,
        LOGOUT_GOG: AuthStates.UNAUTHENTICATED,
        LOGOUT_ALL: AuthStates.UNAUTHENTICATED,
      },
      [AuthStates.FULLY_AUTHENTICATED]: {
        LOGOUT_STEAM: AuthStates.GOG_AUTHENTICATED,
        LOGOUT_GOG: AuthStates.STEAM_AUTHENTICATED,
        LOGOUT_ALL: AuthStates.UNAUTHENTICATED,
      },
    };

    // Définition des transitions d'import valides
    this.importTransitions = {
      [ImportStates.IDLE]: {
        START_IMPORT: ImportStates.FETCHING_STEAM,
      },
      [ImportStates.FETCHING_STEAM]: {
        STEAM_FETCHED: ImportStates.MATCHING_GAMES,
        ERROR: ImportStates.ERROR,
      },
      [ImportStates.MATCHING_GAMES]: {
        GAMES_MATCHED: ImportStates.IMPORTING_TO_GOG,
        ERROR: ImportStates.ERROR,
      },
      [ImportStates.IMPORTING_TO_GOG]: {
        IMPORT_COMPLETE: ImportStates.COMPLETED,
        ERROR: ImportStates.ERROR,
      },
      [ImportStates.COMPLETED]: {
        RESET: ImportStates.IDLE,
      },
      [ImportStates.ERROR]: {
        RESET: ImportStates.IDLE,
        RETRY: ImportStates.FETCHING_STEAM,
      },
    };
  }

  // Gestion des souscripteurs pour les changements d'état
  subscribe(callback) {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  // Notification des changements d'état
  notifySubscribers(type, from, to, payload = null) {
    const stateChange = {
      type,
      from,
      to,
      payload,
      timestamp: new Date().toISOString(),
    };

    // Ajouter à l'historique
    this.history.push(stateChange);

    // Garder seulement les 50 derniers changements
    if (this.history.length > 50) {
      this.history.shift();
    }

    // Notifier tous les souscripteurs
    this.subscribers.forEach((callback) => {
      try {
        callback(stateChange);
      } catch (error) {
        ErrorUtils.logError(error, "StateMachine subscriber notification");
      }
    });
  }

  // Transition d'état d'authentification
  transitionAuth(action, payload = null) {
    const currentTransitions = this.authTransitions[this.currentState];

    if (!currentTransitions || !currentTransitions[action]) {
      throw new Error(
        `Invalid auth transition: ${action} from state ${this.currentState}`
      );
    }

    const previousState = this.currentState;
    this.currentState = currentTransitions[action];

    this.notifySubscribers(
      "AUTH_STATE_CHANGE",
      previousState,
      this.currentState,
      payload
    );

    return this.currentState;
  }

  // Transition d'état d'import
  transitionImport(action, payload = null) {
    const currentTransitions = this.importTransitions[this._importState];

    if (!currentTransitions || !currentTransitions[action]) {
      throw new Error(
        `Invalid import transition: ${action} from state ${this._importState}`
      );
    }

    const previousState = this._importState;
    this._importState = currentTransitions[action];

    this.notifySubscribers(
      "IMPORT_STATE_CHANGE",
      previousState,
      this._importState,
      payload
    );

    return this._importState;
  }

  // Vérification de la validité d'une transition
  canTransitionAuth(action) {
    const currentTransitions = this.authTransitions[this.currentState];
    return !!(currentTransitions && currentTransitions[action]);
  }

  canTransitionImport(action) {
    const currentTransitions = this.importTransitions[this.importState];
    return !!(currentTransitions && currentTransitions[action]);
  }

  // Getters pour l'état actuel
  get authState() {
    return this.currentState;
  }

  get importState() {
    return this._importState;
  }

  // Vérifications d'état utiles
  get isAuthenticated() {
    return this.currentState !== AuthStates.UNAUTHENTICATED;
  }

  get isFullyAuthenticated() {
    return this.currentState === AuthStates.FULLY_AUTHENTICATED;
  }

  get isSteamAuthenticated() {
    return (
      this.currentState === AuthStates.STEAM_AUTHENTICATED ||
      this.currentState === AuthStates.FULLY_AUTHENTICATED
    );
  }

  get isGogAuthenticated() {
    return (
      this.currentState === AuthStates.GOG_AUTHENTICATED ||
      this.currentState === AuthStates.FULLY_AUTHENTICATED
    );
  }

  get isImporting() {
    return (
      this.importState !== ImportStates.IDLE &&
      this.importState !== ImportStates.COMPLETED &&
      this.importState !== ImportStates.ERROR
    );
  }

  get canStartImport() {
    return this.isFullyAuthenticated && this.importState === ImportStates.IDLE;
  }

  // Méthodes pour forcer un état (à utiliser avec précaution)
  forceAuthState(state, reason = "forced") {
    if (!Object.values(AuthStates).includes(state)) {
      throw new Error(`Invalid auth state: ${state}`);
    }

    const previousState = this.currentState;
    this.currentState = state;

    this.notifySubscribers(
      "AUTH_STATE_FORCED",
      previousState,
      this.currentState,
      { reason }
    );

    return this.currentState;
  }

  forceImportState(state, reason = "forced") {
    if (!Object.values(ImportStates).includes(state)) {
      throw new Error(`Invalid import state: ${state}`);
    }

    const previousState = this.importState;
    this.importState = state;

    this.notifySubscribers(
      "IMPORT_STATE_FORCED",
      previousState,
      this.importState,
      { reason }
    );

    return this.importState;
  }

  // Reset complet de la state machine
  reset() {
    const previousAuthState = this.currentState;
    const previousImportState = this.importState;

    this.currentState = AuthStates.UNAUTHENTICATED;
    this.importState = ImportStates.IDLE;

    this.notifySubscribers(
      "STATE_RESET",
      { auth: previousAuthState, import: previousImportState },
      { auth: this.currentState, import: this.importState }
    );
  }

  // Méthodes pour l'historique et le debugging
  getHistory() {
    return [...this.history];
  }

  getLastTransition() {
    return this.history[this.history.length - 1] || null;
  }

  clearHistory() {
    this.history = [];
  }

  // État complet pour la sérialisation
  getFullState() {
    return {
      auth: this.currentState,
      import: this.importState,
      isAuthenticated: this.isAuthenticated,
      isFullyAuthenticated: this.isFullyAuthenticated,
      isSteamAuthenticated: this.isSteamAuthenticated,
      isGogAuthenticated: this.isGogAuthenticated,
      isImporting: this.isImporting,
      canStartImport: this.canStartImport,
      lastTransition: this.getLastTransition(),
    };
  }
}

// Exposer la classe dans le contexte global
self.StateMachine = StateMachine;
