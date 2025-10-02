// import { ApiService } from "./ApiService.js";
// import { StorageService } from "./StorageService.js";
// import { StateMachine } from "../shared/StateMachine.js";
// import { ErrorUtils } from "../shared/utils.js";
// import { ErrorTypes, ImportStates } from "../shared/constants.js";

class WishlistService {
  constructor(apiService, storageService, stateMachine) {
    this.apiService = apiService || new ApiService();
    this.storageService = storageService || new StorageService();
    this.stateMachine = stateMachine || new StateMachine();
  }

  // === RÉCUPÉRATION WISHLIST STEAM ===

  async getSteamWishlist(userId = null, skipStateTransition = false) {
    try {
      // Gestion des transitions d'état uniquement si pas d'appel interne
      if (!skipStateTransition) {
        // Réinitialiser la state machine si elle est en état ERROR
        if (this.stateMachine.importState === ImportStates.ERROR) {
          this.stateMachine.transitionImport("RESET");
        }

        // Transition vers l'état de récupération
        this.stateMachine.transitionImport("START_IMPORT");
      }

      const tokens = await this.storageService.getAuthTokens();
      const steamUserId = userId || tokens.steam_user_id;

      if (!steamUserId) {
        throw new Error("Steam user ID not available");
      }

      // Récupérer toute la wishlist avec le scroll automatique
      const wishlistData = await this.apiService.getSteamWishlist(steamUserId);

      if (!wishlistData || Object.keys(wishlistData).length === 0) {
        console.warn("[WishlistService] No Steam wishlist data found");

        // Transition d'état uniquement si pas d'appel interne
        if (!skipStateTransition) {
          this.stateMachine.transitionImport("STEAM_FETCHED", {
            count: 0,
            pages: 0,
          });
        }

        return {
          games: [],
          count: 0,
          userId: steamUserId,
          pages: 0,
        };
      }

      // Extraire les IDs des jeux de la wishlist
      const wishlist = Object.keys(wishlistData);

      // Transition vers l'état suivant uniquement si pas d'appel interne
      if (!skipStateTransition) {
        this.stateMachine.transitionImport("STEAM_FETCHED", {
          count: wishlist.length,
          pages: 1,
        });
      }

      return {
        games: wishlist,
        count: wishlist.length,
        userId: steamUserId,
        pages: 1,
      };
    } catch (error) {
      // Ne faire la transition vers ERROR que si on n'y est pas déjà et pas d'appel interne
      if (
        !skipStateTransition &&
        this.stateMachine.importState !== ImportStates.ERROR
      ) {
        this.stateMachine.transitionImport("ERROR", { error: error.message });
      }

      throw ErrorUtils.createError(
        ErrorTypes.NETWORK_ERROR,
        "Failed to get Steam wishlist",
        error
      );
    }
  } // === RÉCUPÉRATION WISHLIST GOG ===

  async getGogWishlist(accessToken = null) {
    try {
      const tokens = await this.storageService.getAuthTokens();
      const gogAccessToken = accessToken || tokens.gog_access_token;

      if (!gogAccessToken) {
        throw new Error("GOG access token not available");
      }

      const response = await this.apiService.getGogWishlist(gogAccessToken);

      if (!response.wishlist) {
        throw new Error("Invalid GOG wishlist response format");
      }

      // Extraire les IDs des jeux GOG
      const gogGameIds = Object.keys(response.wishlist).map((id) =>
        parseInt(id)
      );

      return {
        games: gogGameIds,
        count: gogGameIds.length,
        rawData: response.wishlist,
      };
    } catch (error) {
      throw ErrorUtils.createError(
        ErrorTypes.NETWORK_ERROR,
        "Failed to get GOG wishlist",
        error
      );
    }
  }

  // === CORRESPONDANCE DES JEUX ===

  async matchSteamGamesToGog(steamAppIds, progressCallback = null) {
    try {
      this.stateMachine.transitionImport("GAMES_MATCHED");

      const matches = [];
      const errors = [];

      console.log(
        `[WishlistService] Matching ${steamAppIds.length} Steam games to GOG...`
      );

      // Utiliser la nouvelle méthode batch pour tous les IDs à la fois
      try {
        const gogGameIds = await this.apiService.getGogGameIds(steamAppIds);

        // Créer les correspondances
        steamAppIds.forEach((steamAppId, index) => {
          const gogGameId = gogGameIds[index];
          if (gogGameId && gogGameId !== -1) {
            matches.push({ steamAppId, gogGameId, success: true });
          } else {
            matches.push({ steamAppId, gogGameId: -1, success: false });
          }

          // Callback de progression
          if (progressCallback) {
            progressCallback({
              processed: index + 1,
              total: steamAppIds.length,
              percentage: Math.round(((index + 1) / steamAppIds.length) * 100),
            });
          }
        });
      } catch (batchError) {
        console.warn(
          "[WishlistService] Batch matching failed, using fallback:",
          batchError.message
        );

        // Fallback: traiter individuellement si le batch échoue
        let processed = 0;
        const batchSize = 5;
        const batches = this.createBatches(steamAppIds, batchSize);

        for (const batch of batches) {
          const batchPromises = batch.map(async (steamAppId) => {
            try {
              const gogGameId = await this.apiService.getGogGameId(steamAppId);
              return { steamAppId, gogGameId, success: true };
            } catch (error) {
              errors.push({ steamAppId, error: error.message });
              return { steamAppId, gogGameId: -1, success: false };
            }
          });

          const batchResults = await Promise.allSettled(batchPromises);

          batchResults.forEach((result) => {
            if (result.status === "fulfilled") {
              matches.push(result.value);
            } else {
              errors.push({
                steamAppId: "unknown",
                error: result.reason?.message || "Unknown error",
              });
            }

            processed++;

            // Callback de progression si fourni
            if (progressCallback) {
              progressCallback({
                processed,
                total: steamAppIds.length,
                percentage: Math.round((processed / steamAppIds.length) * 100),
              });
            }
          });

          // Pause entre les lots
          if (batches.indexOf(batch) < batches.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }
      }

      return {
        matches,
        errors,
        stats: {
          total: steamAppIds.length,
          matched: matches.filter((m) => m.success && m.gogGameId !== -1)
            .length,
          notFound: matches.filter((m) => m.success && m.gogGameId === -1)
            .length,
          failed: errors.length,
        },
      };
    } catch (error) {
      this.stateMachine.transitionImport("ERROR", { error: error.message });
      throw ErrorUtils.createError(
        ErrorTypes.IMPORT_ERROR,
        "Failed to match Steam games to GOG",
        error
      );
    }
  }

  // === IMPORT VERS GOG ===

  async importToGogWishlist(
    steamWishlist,
    progressCallback = null,
    skipStateValidation = false
  ) {
    try {
      // Validation d'état uniquement si pas d'appel depuis performFullImport
      if (!skipStateValidation && !this.stateMachine.canStartImport) {
        throw new Error("Cannot start import in current state");
      }

      // Récupérer la wishlist GOG existante
      const gogWishlist = await this.getGogWishlist();

      // Correspondance des jeux
      const matchingResults = await this.matchSteamGamesToGog(
        steamWishlist.games,
        progressCallback
      );

      // Transition vers l'état d'import uniquement si pas d'appel interne
      if (!skipStateValidation) {
        this.stateMachine.transitionImport("GAMES_MATCHED", {
          matchingStats: matchingResults.stats,
        });
      }

      // Filtrer les jeux à ajouter
      const gamesToAdd = matchingResults.matches.filter(
        (match) =>
          match.success &&
          match.gogGameId !== -1 &&
          !gogWishlist.games.includes(match.gogGameId)
      );

      const results = {
        added: 0,
        alreadyInWishlist: 0,
        notFound: matchingResults.stats.notFound,
        errors: [...matchingResults.errors],
      };

      // Compter les jeux déjà dans la wishlist
      results.alreadyInWishlist = matchingResults.matches.filter(
        (match) =>
          match.success &&
          match.gogGameId !== -1 &&
          gogWishlist.games.includes(match.gogGameId)
      ).length;

      if (gamesToAdd.length === 0) {
        if (!skipStateValidation) {
          this.stateMachine.transitionImport("IMPORT_COMPLETE", { results });
        }
        return results;
      }

      // Ajouter les jeux à la wishlist GOG
      const tokens = await this.storageService.getAuthTokens();

      if (!tokens.gog_access_token) {
        throw new Error("GOG access token not available");
      }

      let processed = 0;
      const batchSize = 3; // Plus conservateur pour les ajouts
      const batches = this.createBatches(gamesToAdd, batchSize);

      for (const batch of batches) {
        const batchPromises = batch.map(async (match) => {
          try {
            await this.apiService.addToGogWishlist(
              match.gogGameId,
              tokens.gog_access_token
            );
            results.added++;
            return { success: true, gogGameId: match.gogGameId };
          } catch (error) {
            results.errors.push({
              steamAppId: match.steamAppId,
              gogGameId: match.gogGameId,
              error: error.message,
            });
            return { success: false, error: error.message };
          }
        });

        await Promise.allSettled(batchPromises);
        processed += batch.length;

        // Callback de progression
        if (progressCallback) {
          progressCallback({
            phase: "importing",
            processed,
            total: gamesToAdd.length,
            percentage: Math.round((processed / gamesToAdd.length) * 100),
          });
        }

        // Pause entre les lots
        if (batches.indexOf(batch) < batches.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }

      if (!skipStateValidation) {
        this.stateMachine.transitionImport("IMPORT_COMPLETE", { results });
      }
      return results;
    } catch (error) {
      if (!skipStateValidation) {
        this.stateMachine.transitionImport("ERROR", { error: error.message });
      }
      throw ErrorUtils.createError(
        ErrorTypes.IMPORT_ERROR,
        "Failed to import wishlist to GOG",
        error
      );
    }
  }

  // === UTILITAIRES ===

  createBatches(array, batchSize) {
    const batches = [];
    for (let i = 0; i < array.length; i += batchSize) {
      batches.push(array.slice(i, i + batchSize));
    }
    return batches;
  }

  async resetImportState() {
    try {
      this.stateMachine.transitionImport("RESET");
      return { success: true };
    } catch (error) {
      // Si on ne peut pas transitionner normalement, forcer le reset
      this.stateMachine.forceImportState("IDLE", "manual_reset");
      return { success: true, forced: true };
    }
  }

  // === OPÉRATION COMPLÈTE D'IMPORT ===

  async performFullImport(progressCallback = null) {
    try {
      // Vérifier l'état d'authentification
      if (!this.stateMachine.isFullyAuthenticated) {
        throw new Error("Full authentication required for import");
      }

      let overallProgress = {
        phase: "starting",
        percentage: 0,
        message: "Initializing import...",
      };

      if (progressCallback) progressCallback(overallProgress);

      // 1. Récupérer la wishlist Steam
      overallProgress = {
        ...overallProgress,
        phase: "fetching_steam",
        percentage: 10,
        message: "Fetching Steam wishlist...",
      };
      if (progressCallback) progressCallback(overallProgress);

      // Utiliser skipStateTransition=true car nous gérons déjà les états dans performFullImport
      const steamWishlist = await this.getSteamWishlist(null, true);

      // 2. Effectuer l'import
      overallProgress = {
        ...overallProgress,
        phase: "importing",
        percentage: 30,
        message: "Starting import process...",
      };
      if (progressCallback) progressCallback(overallProgress);

      const results = await this.importToGogWishlist(
        steamWishlist,
        (subProgress) => {
          // Combiner le progrès de l'import avec le progrès global
          const adjustedPercentage = 30 + subProgress.percentage * 0.7; // 30% + 70% pour l'import

          if (progressCallback) {
            progressCallback({
              ...overallProgress,
              percentage: Math.round(adjustedPercentage),
              message:
                subProgress.phase === "importing"
                  ? `Adding games to GOG wishlist... (${subProgress.processed}/${subProgress.total})`
                  : `Matching games... (${subProgress.processed}/${subProgress.total})`,
            });
          }
        },
        true // skipStateValidation=true car nous gérons les états dans performFullImport
      );

      // 3. Finaliser
      overallProgress = {
        ...overallProgress,
        phase: "completed",
        percentage: 100,
        message: "Import completed!",
      };
      if (progressCallback) progressCallback(overallProgress);

      return {
        success: true,
        steamWishlist,
        results,
        summary: {
          steamGames: steamWishlist.count,
          added: results.added,
          alreadyInWishlist: results.alreadyInWishlist,
          notFound: results.notFound,
          errors: results.errors.length,
        },
      };
    } catch (error) {
      if (progressCallback) {
        progressCallback({
          phase: "error",
          percentage: 0,
          message: `Import failed: ${error.message}`,
        });
      }

      throw ErrorUtils.createError(
        ErrorTypes.IMPORT_ERROR,
        "Full import operation failed",
        error
      );
    }
  }
}

// Exposer la classe pour les autres modules
self.WishlistService = WishlistService;
