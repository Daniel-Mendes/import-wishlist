// import { ErrorTypes } from "./constants.js";

// Utilitaires pour la validation des données
class ValidationUtils {
  static validateSchema(data, schema) {
    if (!data || typeof data !== "object") {
      throw new Error(`${ErrorTypes.VALIDATION_ERROR}: Data must be an object`);
    }

    if (schema.required) {
      for (const field of schema.required) {
        if (!(field in data)) {
          throw new Error(
            `${ErrorTypes.VALIDATION_ERROR}: Missing required field: ${field}`
          );
        }
      }
    }

    if (schema.type && typeof data !== schema.type) {
      throw new Error(
        `${ErrorTypes.VALIDATION_ERROR}: Expected type ${
          schema.type
        }, got ${typeof data}`
      );
    }

    return true;
  }

  static sanitizeHtml(html) {
    const div = document.createElement("div");
    div.textContent = html;
    return div.innerHTML;
  }

  static isValidUrl(string) {
    try {
      new URL(string);
      return true;
    } catch (_) {
      return false;
    }
  }
}

// Utilitaires pour la gestion des erreurs
class ErrorUtils {
  static createError(type, message, originalError = null) {
    const error = new Error(`${type}: ${message}`);
    error.type = type;
    error.originalError = originalError;
    return error;
  }

  static logError(error, context = "") {
    const timestamp = new Date().toISOString();
    const errorInfo = {
      timestamp,
      context,
      type: error.type || "UNKNOWN_ERROR",
      message: error.message,
      stack: error.stack,
    };

    console.error("[Extension Error]", errorInfo);

    // Dans une version production, on pourrait envoyer ces logs à un service d'analyse
    return errorInfo;
  }
}

// Utilitaires pour la gestion des promesses
class PromiseUtils {
  static async withTimeout(
    promise,
    timeoutMs,
    errorMessage = "Operation timeout"
  ) {
    return Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
      ),
    ]);
  }

  static async retry(fn, maxAttempts = 3, delay = 1000) {
    let lastError;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;

        if (attempt === maxAttempts) {
          throw error;
        }

        await new Promise((resolve) => setTimeout(resolve, delay * attempt));
      }
    }

    throw lastError;
  }
}

// Utilitaires pour le DOM et l'UI
class DomUtils {
  static getElementById(id) {
    const element = document.getElementById(id);
    if (!element) {
      throw new Error(`Element with id '${id}' not found`);
    }
    return element;
  }

  static safeSetTextContent(elementId, text) {
    try {
      const element = this.getElementById(elementId);
      element.textContent = String(text || "");
    } catch (error) {
      ErrorUtils.logError(error, `Setting text content for ${elementId}`);
    }
  }

  static safeSetAttribute(elementId, attribute, value) {
    try {
      const element = this.getElementById(elementId);
      element.setAttribute(attribute, String(value || ""));
    } catch (error) {
      ErrorUtils.logError(
        error,
        `Setting attribute ${attribute} for ${elementId}`
      );
    }
  }

  static safeToggleDisplay(elementId, show) {
    try {
      const element = this.getElementById(elementId);
      element.style.display = show ? "block" : "none";
    } catch (error) {
      ErrorUtils.logError(error, `Toggling display for ${elementId}`);
    }
  }
}

// Utilitaires pour la communication Chrome
class ChromeUtils {
  static async sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });
  }

  static async getFromStorage(keys) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(keys, (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(result);
        }
      });
    });
  }

  static async setToStorage(data) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set(data, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  }
}

// Utilitaires pour les calculs de fenêtre
class WindowUtils {
  static calculateCenterPosition(width, height) {
    // Dans un service worker, screen n'est pas disponible
    // Utiliser des valeurs par défaut raisonnables
    if (typeof screen === "undefined") {
      return {
        width,
        height,
        left: Math.max(0, Math.floor(1920 / 2 - width / 2)), // Assume 1920px width
        top: Math.max(0, Math.floor(1080 / 2 - height / 2)), // Assume 1080px height
      };
    }

    const left = Math.floor(screen.width / 2 - width / 2);
    const top = Math.floor(screen.height / 2 - height / 2);

    return {
      width,
      height,
      left: Math.max(0, left),
      top: Math.max(0, top),
    };
  }
}

// Exposer les utilitaires dans le contexte global
self.ValidationUtils = ValidationUtils;
self.ErrorUtils = ErrorUtils;
self.PromiseUtils = PromiseUtils;
self.DomUtils = DomUtils;
self.ChromeUtils = ChromeUtils;
self.WindowUtils = WindowUtils;
