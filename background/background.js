function startGogLogin(gogLoginSizes) {
    chrome.tabs.create({
        "url": "https://login.gog.com/auth?client_id=46899977096215655&redirect_uri=https%3A%2F%2Fembed.gog.com%2Fon_login_success%3Forigin%3Dclient&response_type=code&layout=client2",
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

    chrome.identity.launchWebAuthFlow({
        "url": `https://steamcommunity.com/openid/login?${new URLSearchParams(steamOpenIDParams)}`,
        "interactive": true,
    }, (response) => {
        const queryParameters = decodeURI(response).split("?")[1];
        const urlParameters = new URLSearchParams(queryParameters);
        const claimedId = urlParameters.get("openid.claimed_id");
        const steamUserID = claimedId.split("/")[claimedId.split("/").length - 1];
        chrome.storage.local.set({"steam_user_id": steamUserID}, () => {
            chrome.runtime.sendMessage({
                "type": "steamLoggedIn",
                "steam_user_id": steamUserID,
            });
        });
    });
}

function getGogWishlist() {
    return new Promise((resolve, reject) => {
        chrome.storage.local.get(["gog_access_token"], (result) => {
            if (result.gog_access_token) {
                fetch("https://embed.gog.com/user/wishlist.json", {
                    "method": "GET",
                    "headers": {
                        "Authorization": `Bearer ${result.gog_access_token}`,
                        "Accept": "application/json",
                        "Content-Type": "application/json"
                    }
                }).then(response => {
                    return response.json();
                })
                    .then(data => {
                        const gogWishlistID = [];
                        Object.entries(data.wishlist).forEach(item => {
                            const [id] = item;
                            gogWishlistID.push(parseInt(id));
                        });
                        resolve(gogWishlistID);
                    })
                    .catch(error => {
                        console.log(error);
                    });
            } else {
                chrome.runtime.onMessage({
                    "type": "alert",
                    "message": "Please connect to your GOG.com account",
                    "timeout": 5000,
                });
            }
        });
    });
}

/* eslint no-constant-condition: ["error", { "checkLoops": false }]*/
function getSteamWishlist() {
    return new Promise((resolve, reject) => {
        chrome.storage.local.get(["steam_user_id"], async(result) => {
            let pageNumber = 0;
            const steamWishlist = [];
    
            // Fetch all pages while data not empty
            do {
                const request = await fetch(`https://store.steampowered.com/wishlist/profiles/${result.steam_user_id}/wishlistdata?p=${pageNumber}`, {
                    "method": "GET",
                    "headers": {
                        "Accept": "application/json",
                        "Content-Type": "application/json"
                    }
                });
                
                const data = await request.json();
               
                if (data.length === 0) {
                    break;
                } else {
                    Object.entries(data).forEach(item => {
                        steamWishlist.push(item[1].name);
                    });
        
                    pageNumber++;
                }
            } while (true);
            
            return resolve(steamWishlist);
        });
    });
}

function removeAllFromWishlist() {
    return new Promise((resolve, reject) => {
        getGogWishlist()
            .then(gogWishlist => {
                for (let i = 0; i < gogWishlist.length; i++) {
                    fetch(`https://embed.gog.com/user/wishlist/remove/${gogWishlist[i]}`);
                }
                resolve();
            });
    });
}

async function addSteamWishlistToGog(steamWishlist, gogWishlist) {
    const results = {
        "added": 0,
        "notFound": 0,
        "alreadyInWishlist": 0,
    };

    const requests = steamWishlist.map((game) => fetch(`https://embed.gog.com/games/ajax/filtered?mediaType=game&search=${game}`));
    const responses = await Promise.all(requests);
    const promises = responses.map((response) => response.json());
    const data = await Promise.all(promises);
    data.forEach((search, index) => {
        if (search.products.length === 0) {
            results.notFound++;
        } else if (search.products.length === 1) {
            if (steamWishlist[index].toLowerCase() === search.products[0].title.toLowerCase()) {
                if (gogWishlist.includes(search.products[0].id)) {
                    results.alreadyInWishlist++;
                } else {
                    fetch(`https://embed.gog.com/user/wishlist/add/${search.products[0].id}`);
                    results.added++;
                }
            }
        } else {
            search.products.forEach((product) => {
                if (product.title.toLowerCase() === steamWishlist[index].toLowerCase()) {
                    if (gogWishlist.includes(product.id)) {
                        results.alreadyInWishlist++;
                    } else {
                        fetch(`https://embed.gog.com/user/wishlist/add/${product.id}`);
                        results.added++;
                    }
                }
            });
        }
    });

    return results;
}

function importWishlist(removeAll) {
    if (removeAll) {
        removeAllFromWishlist()
            .then(() => {
                getSteamWishlist()
                    .then(steamWishlist => {
                        getGogWishlist()
                            .then(gogWishlist => {
                                addSteamWishlistToGog(steamWishlist, gogWishlist)
                                    .then(results => {
                                        chrome.runtime.sendMessage({
                                            "type": "wishlistImported",
                                            "results": results,
                                        });
                                    });
                            });
                    });
            });
    } else {
        getSteamWishlist()
            .then(steamWishlist => {
                getGogWishlist()
                    .then(gogWishlist => {
                        addSteamWishlistToGog(steamWishlist, gogWishlist)
                            .then(results => {
                                chrome.runtime.sendMessage({
                                    "type": "wishlistImported",
                                    "results": results,
                                });
                            });
                    });
            });
    }
}

function refreshGogAccessToken() {
    return new Promise((resolve, reject) => {
        chrome.storage.local.get(["gog_refresh_token"], (result) => {
            if (result.gog_refresh_token) {
                fetch(`https://auth.gog.com/token?${new URLSearchParams({
                    "client_id": "46899977096215655",
                    "client_secret": "9d85c43b1482497dbbce61f6e4aa173a433796eeae2ca8c5f6129f2dc4de46d9",
                    "grant_type": "refresh_token",
                    "refresh_token": result.gog_refresh_token,
                })}`, {
                    "method": "GET",
                    "headers": {
                        "Content-Type": "application/json",
                        "Accept": "application/json"
                    },
                }).then(response => response.json())
                    .then(data => {
                        chrome.storage.local.set({
                            "gog_access_token": data.access_token,
                            "gog_refresh_token": data.refresh_token,
                        }, () => {
                            resolve(data.access_token);
                        });
                    });
            } else {
                reject();
            }
        });
    });
}

chrome.webNavigation.onCompleted.addListener((data) => {
    if (data.url && data.url.includes("https://embed.gog.com/on_login_success?origin=client")) {
        const queryParameters = data.url.split("?")[1];
        const urlParameters = new URLSearchParams(queryParameters);

        chrome.tabs.remove(data.tabId);

        chrome.tabs.create({
            "url": `https://auth.gog.com/token?${new URLSearchParams({
                "client_id": "46899977096215655",
                "client_secret": "9d85c43b1482497dbbce61f6e4aa173a433796eeae2ca8c5f6129f2dc4de46d9",
                "grant_type": "authorization_code",
                "code": urlParameters.get("code"),
                "redirect_uri": encodeURI("https://embed.gog.com/on_login_success?origin=client")
            })}`,
        });
    }

    if (data.url && data.url.includes("https://auth.gog.com/token?client_id=46899977096215655&client_secret=9d85c43b1482497dbbce61f6e4aa173a433796eeae2ca8c5f6129f2dc4de46d9")) {
        chrome.tabs.sendMessage(data.tabId, {
            "type": "gogGetAccessToken"
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
            importWishlist(message.removeAll);
            break;
        case "refreshGogAccessToken":
            refreshGogAccessToken()
                .then(gogAccessToken => {
                    chrome.runtime.sendMessage({
                        "type": "gogAccessTokenRefreshed",
                        "gogAccessToken": gogAccessToken
                    });
                })
                .catch(error => {
                    chrome.runtime.onMessage({
                        "type": "alert",
                        "message": "Please connect to your GOG.com account",
                        "timeout": 5000,
                    });
                });
            break;
        case "gogAccessTokenSuccess":
            chrome.tabs.remove(sender.tab.id);
            break;
    }
});
