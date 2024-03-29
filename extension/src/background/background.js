let gogLoginSizes;

function startGogLogin() {
  chrome.windows.create({
    url: "https://login.gog.com/auth?client_id=46899977096215655&redirect_uri=https%3A%2F%2Fembed.gog.com%2Fon_login_success%3Forigin%3Dclient&response_type=code&layout=client2",
    type: "popup",
    ...gogLoginSizes,
  });
}

function startSteamLogin() {
  const extensionRedirectURL = chrome.identity.getRedirectURL();

  const steamOpenIDParams = {
    "openid.ns": "https://specs.openid.net/auth/2.0",
    "openid.mode": "checkid_setup",
    "openid.return_to": extensionRedirectURL,
    "openid.realm": extensionRedirectURL,
    "openid.identity": "https://specs.openid.net/auth/2.0/identifier_select",
    "openid.claimed_id": "https://specs.openid.net/auth/2.0/identifier_select",
  };

  chrome.identity.launchWebAuthFlow(
    {
      url: `https://steamcommunity.com/openid/login?${new URLSearchParams(
        steamOpenIDParams
      )}`,
      interactive: true,
    },
    (response) => {
      const queryParameters = decodeURI(response).split("?")[1];
      const urlParameters = new URLSearchParams(queryParameters);
      const claimedId = urlParameters.get("openid.claimed_id");
      const steamUserID = claimedId.split("/")[claimedId.split("/").length - 1];
      chrome.storage.local.set({ steam_user_id: steamUserID }, () => {
        chrome.runtime.sendMessage({
          type: "alert",
          status: "success",
          message: chrome.i18n.getMessage("alertSteamSignIn"),
          timeout: 5000,
        });

        chrome.runtime.sendMessage({
          type: "steamLoggedIn",
          steam_user_id: steamUserID,
        });
      });
    }
  );
}

async function getGogWishlist() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(["gog_access_token"], (result) => {
      if (result.gog_access_token) {
        fetch("https://embed.gog.com/user/wishlist.json", {
          method: "GET",
          headers: {
            Authorization: `Bearer ${result.gog_access_token}`,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        })
          .then((response) => {
            return response.json();
          })
          .then((data) => {
            const gogWishlistID = [];
            Object.entries(data.wishlist).forEach((item) => {
              const [id] = item;
              gogWishlistID.push(parseInt(id));
            });
            resolve(gogWishlistID);
          })
          .catch((error) => {
            console.log(error);
          });
      } else {
        chrome.runtime.onMessage({
          type: "alert",
          status: "error",
          message: chrome.i18n.getMessage("alertGogNotSignIn"),
          timeout: 5000,
        });
      }
    });
  });
}

async function getSteamWishlist() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(["steam_user_id"], async (result) => {
      let pageNumber = 0;
      const steamWishlist = [];

      // Fetch all pages while data not empty
      do {
        const request = await fetch(
          `https://store.steampowered.com/wishlist/profiles/${result.steam_user_id}/wishlistdata?p=${pageNumber}`,
          {
            method: "GET",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
              "Allow-Control-Allow-Origin": "*",
            },
          }
        );

        const data = await request.json();

        if (data.length === 0) {
          break;
        } else {
          Object.keys(data).forEach((key) => {
            steamWishlist.push(key);
          });
          pageNumber++;
        }
      } while (true);

      return resolve(steamWishlist);
    });
  });
}

async function addSteamWishlistToGog(steamWishlist, gogWishlist) {
  const results = {
    added: 0,
    notFound: 0,
    alreadyInWishlist: 0,
  };

  const WISHLIST_COUNT_PER_REQUEST = 50;

  const queries = [];

  for (let i = 0; i < steamWishlist.length; i += WISHLIST_COUNT_PER_REQUEST) {
    const query = fetch(
      "https://import-wishlist.netlify.app/.netlify/functions/get-gog-game-id",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          steamWishlist.slice(i, i + WISHLIST_COUNT_PER_REQUEST)
        ),
      }
    )
      .then((response) => response.json())
      .then((data) => {
        return data;
      });

    queries.push(query);
  }

  return Promise.all(queries)
    .then((responses) => {
      return responses.flat();
    })
    .then((data) => {
      for (const gogGameId of data) {
        if (isNaN(gogGameId)) {
          throw new Error(
            chrome.i18n.getMessage("alertErrorWhileImportingWishlist")
          );
        }

        if (gogGameId === -1) {
          results.notFound++;
          continue;
        }

        if (gogWishlist.includes(gogGameId)) {
          results.alreadyInWishlist++;
        } else {
          fetch(`https://embed.gog.com/user/wishlist/add/${gogGameId}`);
          results.added++;
        }
      }

      return results;
    })
    .catch((error) => {
      chrome.runtime.sendMessage({
        type: "alert",
        status: "error",
        message: error.message,
        timeout: 5000,
      });
    });
}

async function importWishlist() {
  const [steamWishlist, gogWishlist] = await Promise.all([
    getSteamWishlist(),
    getGogWishlist(),
  ]);

  addSteamWishlistToGog(steamWishlist, gogWishlist).then((results) => {
    chrome.runtime.sendMessage({
      type: "wishlistImported",
      results: results,
    });
  });
}

function refreshGogAccessToken() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(["gog_refresh_token"], (result) => {
      if (result.gog_refresh_token) {
        fetch(
          `https://auth.gog.com/token?${new URLSearchParams({
            client_id: "46899977096215655",
            client_secret:
              "9d85c43b1482497dbbce61f6e4aa173a433796eeae2ca8c5f6129f2dc4de46d9",
            grant_type: "refresh_token",
            refresh_token: result.gog_refresh_token,
          })}`,
          {
            method: "GET",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
          }
        )
          .then((response) => response.json())
          .then((data) => {
            chrome.storage.local.set(
              {
                gog_access_token: data.access_token,
                gog_refresh_token: data.refresh_token,
              },
              () => {
                resolve(data.access_token);
              }
            );
          });
      } else {
        reject();
      }
    });
  });
}

chrome.permissions.contains(
  { permissions: ["webRequest", "webRequestBlocking"] },
  (result) => {
    if (result) {
      chrome.webRequest.onHeadersReceived.addListener(
        (details) => {
          const headers = details.responseHeaders;
          const blockingResponse = {};

          for (let i = 0, l = headers.length; i < l; ++i) {
            if (
              headers[i].name === "Content-Type" &&
              headers[i].value === "application/json"
            ) {
              headers[i].value = "text/plain";
              break;
            }
          }

          blockingResponse.responseHeaders = headers;
          return blockingResponse;
        },
        { urls: ["https://auth.gog.com/token*"] },
        ["responseHeaders", "blocking"]
      );
    }
  }
);

chrome.webNavigation.onCompleted.addListener((data) => {
  if (
    data.url &&
    data.url.includes("https://embed.gog.com/on_login_success?origin=client")
  ) {
    const queryParameters = data.url.split("?")[1];
    const urlParameters = new URLSearchParams(queryParameters);

    chrome.tabs.remove(data.tabId);

    chrome.windows.create({
      url: `https://auth.gog.com/token?${new URLSearchParams({
        client_id: "46899977096215655",
        client_secret:
          "9d85c43b1482497dbbce61f6e4aa173a433796eeae2ca8c5f6129f2dc4de46d9",
        grant_type: "authorization_code",
        code: urlParameters.get("code"),
        redirect_uri: encodeURI(
          "https://embed.gog.com/on_login_success?origin=client"
        ),
      })}`,
      type: "popup",
      width: 1,
      height: 1,
      top: 0,
      left: 0,
    });
  }

  if (
    data.url &&
    data.url.includes(
      "https://auth.gog.com/token?client_id=46899977096215655&client_secret=9d85c43b1482497dbbce61f6e4aa173a433796eeae2ca8c5f6129f2dc4de46d9"
    )
  ) {
    chrome.tabs.sendMessage(data.tabId, {
      type: "gogGetAccessToken",
    });
  }
});

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
    case "gogAccessTokenSuccess":
      chrome.tabs.remove(sender.tab.id);
      chrome.runtime.sendMessage({
        type: "gogLoginSuccess",
        gogAccessToken: message.gogAccessToken,
      });
      break;
    case "refreshGogAccessToken":
      refreshGogAccessToken()
        .then((gogAccessToken) => {
          chrome.runtime.sendMessage({
            type: "gogAccessTokenRefreshed",
            gogAccessToken: gogAccessToken,
          });
        })
        .catch((error) => {
          chrome.runtime.onMessage({
            type: "alert",
            status: "error",
            message: chrome.i18n.getMessage("alertGogNotSignIn"),
            timeout: 5000,
          });
        });
      break;
    case "setGogLoginSizes":
      gogLoginSizes = message.gogLoginSizes;
      break;
    case "getGogWishlist":
      getGogWishlist().then((gogWishlist) => {
        sendResponse({
          gogWishlistCount: gogWishlist.length,
        });
      });
      return true;
    case "getSteamWishlist":
      getSteamWishlist().then((steamWishlist) => {
        sendResponse({
          steamWishlistCount: steamWishlist.length,
        });
      });
      return true;
  }
});
