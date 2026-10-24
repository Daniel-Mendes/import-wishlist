const GOG_CLIENT_ID = "46899977096215655";
const GOG_CLIENT_SECRET = "9d85c43b1482497dbbce61f6e4aa173a433796eeae2ca8c5f6129f2dc4de46d9";
const GOG_REDIRECT_URI = "https://embed.gog.com/on_login_success?origin=client";

function sendAlert(status, message, timeout = 6000) {
  chrome.runtime.sendMessage({
    type: "alert",
    status,
    message,
    timeout,
  }).catch(() => {});
}

async function startGogLogin() {
  const sizes = await chrome.storage.local.get(["gog_login_sizes"]);
  const loginSizes = sizes.gog_login_sizes || { width: 393, height: 500, top: 100, left: 100 };

  chrome.windows.create({
    url: `https://login.gog.com/auth?client_id=${GOG_CLIENT_ID}&redirect_uri=${encodeURIComponent(GOG_REDIRECT_URI)}&response_type=code&layout=client2`,
    type: "popup",
    ...loginSizes,
  });
}

function startSteamLogin() {
  const extensionRedirectURL = chrome.identity.getRedirectURL();

  const steamOpenIDParams = {
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "checkid_setup",
    "openid.return_to": extensionRedirectURL,
    "openid.realm": extensionRedirectURL,
    "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
    "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
  };

  chrome.identity.launchWebAuthFlow(
    {
      url: `https://steamcommunity.com/openid/login?${new URLSearchParams(steamOpenIDParams)}`,
      interactive: true,
    },
    (response) => {
      if (chrome.runtime.lastError || !response) {
        sendAlert("error", "Steam login failed: " + (chrome.runtime.lastError ? chrome.runtime.lastError.message : "Window closed"));
        return;
      }

      try {
        const queryParameters = decodeURI(response).split("?")[1];
        const urlParameters = new URLSearchParams(queryParameters);
        const claimedId = urlParameters.get("openid.claimed_id");
        if (!claimedId) return;

        const parts = claimedId.split("/");
        const steamUserID = parts[parts.length - 1];

        chrome.storage.local.set({ steam_user_id: steamUserID }, () => {
          sendAlert("success", chrome.i18n.getMessage("alertSteamSignIn") || "Steam signed in!");
          chrome.runtime.sendMessage({
            type: "steamLoggedIn",
            steam_user_id: steamUserID,
          }).catch(() => {});
        });
      } catch (err) {
        console.error("[Steam Login] Parsing failed:", err);
      }
    }
  );
}

async function setSteamUserByIdOrUrl(input) {
  let idOrVanity = input.trim().replace(/\/$/, "");
  if (idOrVanity.includes("steamcommunity.com/profiles/")) {
    idOrVanity = idOrVanity.split("profiles/")[1];
  } else if (idOrVanity.includes("steamcommunity.com/id/")) {
    idOrVanity = idOrVanity.split("id/")[1];
  }

  if (/^\d{17}$/.test(idOrVanity)) {
    await chrome.storage.local.set({ steam_user_id: idOrVanity });
    return idOrVanity;
  }

  const res = await fetch(`https://steamcommunity.com/id/${encodeURIComponent(idOrVanity)}/?xml=1`, { credentials: "include" });
  const text = await res.text();
  const match = text.match(/<steamID64>(.*?)<\/steamID64>/);
  if (match && match[1]) {
    await chrome.storage.local.set({ steam_user_id: match[1] });
    return match[1];
  }
  throw new Error("Could not find Steam profile for: " + input);
}

async function getSteamProfile() {
  const { steam_user_id } = await chrome.storage.local.get(["steam_user_id"]);
  if (!steam_user_id) return null;

  try {
    const res = await fetch(`https://steamcommunity.com/profiles/${steam_user_id}/?xml=1`, {
      credentials: "include",
    });
    const text = await res.text();

    const steamIDMatch = text.match(/<steamID><!\[CDATA\[(.*?)\]\]><\/steamID>/) || text.match(/<steamID>(.*?)<\/steamID>/);
    const avatarMatch = text.match(/<avatarFull><!\[CDATA\[(.*?)\]\]><\/avatarFull>/) || text.match(/<avatarFull>(.*?)<\/avatarFull>/);
    const customURLMatch = text.match(/<customURL><!\[CDATA\[(.*?)\]\]><\/customURL>/) || text.match(/<customURL>(.*?)<\/customURL>/);

    const steamName = steamIDMatch ? steamIDMatch[1] : steam_user_id;
    const avatarUrl = avatarMatch ? avatarMatch[1] : "";
    const customUrl = customURLMatch && customURLMatch[1] ? customURLMatch[1] : null;

    return {
      steamUserId: steam_user_id,
      steamName,
      avatarUrl,
      profileUrl: customUrl
        ? `https://store.steampowered.com/wishlist/id/${customUrl}`
        : `https://store.steampowered.com/wishlist/profiles/${steam_user_id}`,
    };
  } catch (err) {
    return null;
  }
}

// Intercept GOG login redirect and exchange code directly via fetch
chrome.webNavigation.onCompleted.addListener(async (data) => {
  if (data.url && data.url.includes("embed.gog.com/on_login_success?origin=client")) {
    const queryParameters = data.url.split("?")[1];
    const urlParameters = new URLSearchParams(queryParameters);
    const code = urlParameters.get("code");

    if (data.tabId) {
      chrome.tabs.remove(data.tabId).catch(() => {});
    }

    if (!code) return;

    try {
      const tokenUrl = `https://auth.gog.com/token?${new URLSearchParams({
        client_id: GOG_CLIENT_ID,
        client_secret: GOG_CLIENT_SECRET,
        grant_type: "authorization_code",
        code: code,
        redirect_uri: GOG_REDIRECT_URI,
      })}`;

      const res = await fetch(tokenUrl);
      const tokenData = await res.json();

      if (tokenData.access_token) {
        await chrome.storage.local.set({
          gog_access_token: tokenData.access_token,
          gog_refresh_token: tokenData.refresh_token,
          gog_user_id: tokenData.user_id,
        });

        chrome.runtime.sendMessage({
          type: "gogLoginSuccess",
          gogAccessToken: tokenData.access_token,
        }).catch(() => {});
      }
    } catch (err) {
      sendAlert("error", "Failed to retrieve GOG access token.");
    }
  }
});

async function refreshGogAccessToken() {
  const result = await chrome.storage.local.get(["gog_refresh_token"]);
  if (!result.gog_refresh_token) {
    throw new Error("No refresh token found");
  }

  const tokenUrl = `https://auth.gog.com/token?${new URLSearchParams({
    client_id: GOG_CLIENT_ID,
    client_secret: GOG_CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: result.gog_refresh_token,
  })}`;

  const response = await fetch(tokenUrl);
  const data = await response.json();

  if (data.access_token) {
    await chrome.storage.local.set({
      gog_access_token: data.access_token,
      gog_refresh_token: data.refresh_token || result.gog_refresh_token,
    });
    return data.access_token;
  }
  throw new Error("Token refresh failed");
}

async function getGogWishlist() {
  const { gog_access_token } = await chrome.storage.local.get(["gog_access_token"]);
  if (!gog_access_token) {
    sendAlert("error", chrome.i18n.getMessage("alertGogNotSignIn") || "GOG not signed in");
    return [];
  }

  try {
    const response = await fetch("https://embed.gog.com/user/wishlist.json", {
      headers: {
        Authorization: `Bearer ${gog_access_token}`,
        Accept: "application/json",
      },
    });
    const data = await response.json();
    if (data && data.wishlist) {
      return Object.keys(data.wishlist).map((id) => parseInt(id, 10));
    }
    return [];
  } catch (err) {
    return [];
  }
}

// 1. Extract Wishlist App IDs and any pre-rendered titles from Steam React HTML
async function getSteamWishlist() {
  const { steam_user_id } = await chrome.storage.local.get(["steam_user_id"]);
  if (!steam_user_id) return { items: [], preExtractedTitles: {}, isPrivate: false };

  let targetPath = `profiles/${steam_user_id}`;
  try {
    const profileRes = await fetch(`https://steamcommunity.com/profiles/${steam_user_id}/?xml=1`, { credentials: "include" });
    const profileXml = await profileRes.text();
    const customMatch = profileXml.match(/<customURL><!\[CDATA\[(.*?)\]\]><\/customURL>/) || profileXml.match(/<customURL>(.*?)<\/customURL>/);
    if (customMatch && customMatch[1]) {
      targetPath = `id/${encodeURIComponent(customMatch[1])}`;
    }
  } catch (err) {
    console.warn("[Steam Wishlist] Failed to check custom URL:", err);
  }

  try {
    const url = `https://store.steampowered.com/wishlist/${targetPath}/`;
    const response = await fetch(url, { credentials: "include" });
    
    if (response.url.endsWith("store.steampowered.com/") || response.url === "https://store.steampowered.com/") {
      return { items: [], preExtractedTitles: {}, isPrivate: true };
    }

    const html = await response.text();
    const appIds = new Set();
    const regexAppId = /\\?"(?:appid|nAppId|item_appid)\\?"\s*:\s*(\d+)/gi;
    let m;

    while ((m = regexAppId.exec(html)) !== null) {
      if (m[1] !== "0") {
        appIds.add(m[1]);
      }
    }

    // Extract any pre-rendered game titles from StoreItem cache
    const preExtractedTitles = {};
    const regexStoreItem = /\\?"id\\?"\s*:\s*(\d+)[^}]*?\\?"name\\?"\s*:\s*\\?"(.*?)\\?"/gi;
    while ((m = regexStoreItem.exec(html)) !== null) {
      const rawName = m[2];
      const cleanName = rawName
        .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/\\'/g, "'")
        .replace(/\\"/g, '"');
      preExtractedTitles[m[1]] = cleanName;
    }

    const items = Array.from(appIds);
    console.log(`[Steam Wishlist] Extracted ${items.length} games (${Object.keys(preExtractedTitles).length} pre-rendered titles).`);
    return { items, preExtractedTitles, isPrivate: false };
  } catch (err) {
    console.error("[Steam Wishlist] Error fetching/parsing wishlist:", err);
    return { items: [], preExtractedTitles: {}, isPrivate: false };
  }
}

// 2. Fetch missing titles in parallel batches (~4 seconds for 400 games)
async function resolveAllSteamTitles(appIds, preExtracted = {}) {
  const titles = { ...preExtracted };
  const missingIds = appIds.filter((id) => !titles[id]);
  const BATCH_SIZE = 15;

  console.log(`[Title Resolver] Fetching titles for ${missingIds.length} games in parallel batches...`);

  for (let i = 0; i < missingIds.length; i += BATCH_SIZE) {
    const batch = missingIds.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (id) => {
        try {
          const r = await fetch(`https://store.steampowered.com/api/appdetails?appids=${id}&filters=basic`);
          const d = await r.json();
          if (d[id]?.data?.name) {
            titles[id] = d[id].data.name;
          }
        } catch (e) {}
      })
    );
    // Slight throttle between batches
    if (i + BATCH_SIZE < missingIds.length) {
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
  }

  return titles;
}

// Title normalizer for fuzzy matching
function normalizeTitle(str) {
  return str
    .toLowerCase()
    .replace(/&amp;/g, "&")
    .replace(/[:™®©'’\-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// 3. Search GOG Catalog API and find matching product ID
async function findGogGameIdByTitle(gameTitle) {
  if (!gameTitle) return -1;
  const cleanTitle = gameTitle.replace(/[:™®©]/g, "").replace(/\s+/g, " ").trim();

  try {
    const url = `https://catalog.gog.com/v1/catalog?limit=5&query=${encodeURIComponent(cleanTitle)}`;
    const res = await fetch(url);
    const data = await res.json();

    if (!data.products || data.products.length === 0) {
      return -1;
    }

    const targetNorm = normalizeTitle(gameTitle);

    // Look for exact normalized match first
    for (const prod of data.products) {
      if (normalizeTitle(prod.title) === targetNorm) {
        return parseInt(prod.id, 10);
      }
    }

    // Look for subtitle / contains match
    for (const prod of data.products) {
      const prodNorm = normalizeTitle(prod.title);
      if (prodNorm.includes(targetNorm) || targetNorm.includes(prodNorm)) {
        return parseInt(prod.id, 10);
      }
    }
  } catch (err) {}

  return -1;
}

// 4. Match all Steam games against GOG and add to GOG wishlist
async function addSteamWishlistToGog(steamWishlist, preExtractedTitles, gogWishlist) {
  const { gog_access_token } = await chrome.storage.local.get(["gog_access_token"]);
  const results = { added: 0, notFound: 0, alreadyInWishlist: 0 };

  sendAlert("success", "Matching games against GOG store... please wait.", 15000);

  // Step 1: Resolve all game names
  const allTitlesMap = await resolveAllSteamTitles(steamWishlist, preExtractedTitles);

  // Step 2: Search GOG Catalog in parallel chunks of 10
  const SEARCH_BATCH = 10;
  for (let i = 0; i < steamWishlist.length; i += SEARCH_BATCH) {
    const batch = steamWishlist.slice(i, i + SEARCH_BATCH);

    await Promise.all(
      batch.map(async (appId) => {
        const title = allTitlesMap[appId];
        if (!title) {
          results.notFound++;
          return;
        }

        const gogGameId = await findGogGameIdByTitle(title);

        if (!gogGameId || gogGameId === -1 || isNaN(gogGameId)) {
          results.notFound++;
          return;
        }

        if (gogWishlist.includes(gogGameId)) {
          results.alreadyInWishlist++;
        } else {
          try {
            await fetch(`https://embed.gog.com/user/wishlist/add/${gogGameId}`, {
              headers: { Authorization: `Bearer ${gog_access_token}` },
              credentials: "include",
            });
            results.added++;
            gogWishlist.push(gogGameId);
            console.log(`[GOG Wishlist] Added: "${title}" (GOG ID: ${gogGameId})`);
          } catch (e) {
            console.warn(`Failed to add GOG ID ${gogGameId}:`, e);
          }
        }
      })
    );

    if (i + SEARCH_BATCH < steamWishlist.length) {
      await new Promise((r) => setTimeout(r, 60));
    }
  }

  return results;
}

async function importWishlist() {
  try {
    const [steamResult, gogWishlist] = await Promise.all([
      getSteamWishlist(),
      getGogWishlist(),
    ]);

    if (steamResult.isPrivate) {
      sendAlert("error", "Your Steam wishlist is set to Private.", 8000);
      chrome.runtime.sendMessage({ type: "wishlistImportFailed" }).catch(() => {});
      return;
    }

    if (steamResult.items.length === 0) {
      sendAlert("error", "No Steam games found to import.", 5000);
      chrome.runtime.sendMessage({ type: "wishlistImportFailed" }).catch(() => {});
      return;
    }

    const results = await addSteamWishlistToGog(steamResult.items, steamResult.preExtractedTitles, gogWishlist);
    chrome.runtime.sendMessage({
      type: "wishlistImported",
      results: results,
    }).catch(() => {});
  } catch (err) {
    sendAlert("error", err.message || "Failed to import wishlist.");
    chrome.runtime.sendMessage({ type: "wishlistImportFailed" }).catch(() => {});
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case "startSteamLogin":
      startSteamLogin();
      break;
    case "startGogLogin":
      startGogLogin();
      break;
    case "importWishlist":
      importWishlist();
      break;
    case "setGogLoginSizes":
      chrome.storage.local.set({ gog_login_sizes: message.gogLoginSizes });
      break;
    case "refreshGogAccessToken":
      refreshGogAccessToken()
        .then((token) => {
          chrome.runtime.sendMessage({ type: "gogAccessTokenRefreshed", gogAccessToken: token }).catch(() => {});
        })
        .catch(() => {
          sendAlert("error", chrome.i18n.getMessage("alertGogNotSignIn") || "GOG sign in required");
        });
      break;
    case "getGogWishlist":
      getGogWishlist().then((list) => sendResponse({ gogWishlistCount: list.length }));
      return true;
    case "getSteamProfile":
      getSteamProfile().then(sendResponse);
      return true;
    case "getSteamWishlist":
      getSteamWishlist().then((res) => {
        sendResponse({
          steamWishlistCount: res.items.length,
          isPrivate: res.isPrivate,
        });
      });
      return true;
    case "setSteamUserDirect":
      setSteamUserByIdOrUrl(message.input)
        .then((id) => sendResponse({ success: true, steam_user_id: id }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;
  }
});