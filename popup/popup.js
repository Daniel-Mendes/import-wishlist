const gogLoginWidth = 393;
const gogLoginHeight = 500;
const gogLoginleft = Math.floor((screen.width / 2) - (gogLoginWidth / 2));
const gogLoginTop = Math.floor((screen.height / 2) - (gogLoginHeight / 2));

function alert(message, timeout) {
    document.getElementById("alert").innerText = message;
    document.getElementById("alert").style.display = "block";
    setTimeout(() => {
        document.getElementById("alert").style.display = "none";
    }, timeout);
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
                            gogWishlistID.push(item.id);
                        });
                        resolve(gogWishlistID);
                    })
                    .catch(error => {
                        console.log(error);
                    });
            } else {
                alert("Please connect to your GOG.com account", 5000);
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
    data.map((search, index) => {
        if (search.products.length === 0) {
            return results.notFound++;
        } else if (search.products.length === 1) {
            if (steamWishlist.includes(search.products[0].title) && !gogWishlist.includes(search.products[0].id)) {
                return results.alreadyInWishlist++;
            } else {
                fetch(`https://embed.gog.com/user/wishlist/add/${search.products[0].id}`);
                return results.added++;
            }
        } else {
            search.products
                .filter(product => product.title.toLowerCase() === steamWishlist[index].toLowerCase())
                .map((product) => {
                    if (steamWishlist.includes(product.title) && !gogWishlist.includes(search.products[0].id)) {
                        return results.alreadyInWishlist++;
                    } else {
                        fetch(`https://embed.gog.com/user/wishlist/add/${product.id}`);
                        return results.added++;
                    }
                });
            return results.notFound++;
        }
    });

    return results;
}

function importWhishlist() {
    document.getElementById("icon-rotate").classList.add("icon-spin");

    if (document.getElementById("delete-all-wishlist").checked) {
        removeAllFromWishlist()
            .then(() => {
                getSteamWishlist()
                    .then(steamWishlist => {
                        getGogWishlist()
                            .then(gogWishlist => {
                                addSteamWishlistToGog(steamWishlist, gogWishlist)
                                    .then(results => {
                                        document.getElementById("delete-all-wishlist").checked = false;
                                        document.getElementById("icon-rotate").classList.remove("icon-spin");
                                        alert(`Games added : ${results.added}\n Games not found : ${results.notFound}\n Games already in wishlist : ${results.alreadyInWishlist}`, 10000);
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
                                document.getElementById("icon-rotate").classList.remove("icon-spin");
                                alert(`Games added : ${results.added}\n Games not found : ${results.notFound}\n Games already in wishlist : ${results.alreadyInWishlist}`, 10000);
                            });
                    });
            });
    }
}

function setSteamDetails(steamUseId) {
    fetch(`https://steamcommunity.com/profiles/${steamUseId}/?xml=1`)
        .then(response => {
            response.text()
                .then((content) => {
                    const parser = new DOMParser();
                    const xmlDoc = parser.parseFromString(content, "text/xml");
                    return xmlDoc;
                })
                .then(xmlDoc => {
                    document.getElementById("btn-steam-login").style.display = "none";
                    document.getElementById("steam-avatar").src
                        = xmlDoc.getElementsByTagName("avatarFull")[0].childNodes[0].nodeValue;
                    document.getElementById("steam-name").href
                        = `https://store.steampowered.com/wishlist/id/${xmlDoc.getElementsByTagName("customURL")[0].childNodes[0].nodeValue}`;
                    document.getElementById("steam-name").innerText
                        = xmlDoc.getElementsByTagName("steamID")[0].childNodes[0].nodeValue;
                    document.getElementById("details-steam").style.display = "block";
                });
        });
}

function refrechAccessToken() {
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
                alert("Please connect to your GOG.com account", 5000);
            }
        });
    });
}

function setGogDetails(gogAccessToken) {
    fetch("https://menu.gog.com/v1/account/basic", {
        "headers": {
            "Authorization": `Bearer ${gogAccessToken}`,
        }
    })
        .then(response => {
            if (response.status === 401) {
                return refrechAccessToken();
            } else {
                return response.json();
            }
        })
        .then(data => {
            document.getElementById("btn-gog-login").style.display = "none";
            document.getElementById("gog-avatar").src = data.avatars.menu_user_av_big2;
            document.getElementById("gog-name").innerText = data.username;
            document.getElementById("gog-name").href = `https://www.gog.com/u/${data.username}/wishlist`;
            document.getElementById("details-gog").style.display = "block";
        });
}

document.getElementById("btn-gog-login").addEventListener("click", () => {
    chrome.windows.create({
        "url": "https://login.gog.com/auth?client_id=46899977096215655&redirect_uri=https%3A%2F%2Fembed.gog.com%2Fon_login_success%3Forigin%3Dclient&response_type=code&layout=client2",
        "type": "popup",
        "width": gogLoginWidth,
        "height": gogLoginHeight,
        "top": gogLoginTop,
        "left": gogLoginleft,
    });
});

document.getElementById("btn-steam-login").addEventListener("click", () => {
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
            setSteamDetails(steamUserID);
        });
    });
});

document.getElementById("btn-import-wishlist").addEventListener("click", () => {
    chrome.storage.local.get(["gog_access_token", "steam_user_id"], (result) => {
        if (!result.gog_access_token) {
            return alert("Please connect to your GOG.com account", 5000);
        }
        
        if (!result.steam_user_id) {
            return alert("Please connect to your Steam account", 5000);
        }

        return importWhishlist();
    });
});

chrome.runtime.onMessage.addListener((request, sender, response) => {
    if (request.type === "gogLogin") {
        chrome.tabs.query({
            "url": "https://embed.gog.com/on_login_success?origin=client*"
        }, (tabs) => {
            chrome.tabs.remove(tabs[0].id);
        });
        chrome.windows.create({
            "url": `https://auth.gog.com/token?${new URLSearchParams({
                "client_id": "46899977096215655",
                "client_secret": "9d85c43b1482497dbbce61f6e4aa173a433796eeae2ca8c5f6129f2dc4de46d9",
                "grant_type": "authorization_code",
                "code": request.code,
                "redirect_uri": encodeURI("https://embed.gog.com/on_login_success?origin=client")
            })}`,
            "type": "popup",
            "width": gogLoginWidth,
            "height": gogLoginHeight,
            "top": gogLoginTop,
            "left": gogLoginleft,
        });
    }

    if (request.type === "gogTokenSuccess") {
        chrome.tabs.query({
            "url": "https://auth.gog.com/token*"
        }, (tabs) => {
            chrome.tabs.remove(tabs[0].id);
        });
        alert("Your GOG.com account is now connected", 5000);
        setGogDetails(request.gog_access_token);
    }
});

function checkIfAlreadyAuthenticate() {
    chrome.storage.local.get(["gog_access_token", "steam_user_id"], (result) => {
        if (result.gog_access_token) {
            refrechAccessToken().then((accessToken) => {
                setGogDetails(accessToken);
            });
        }

        if (result.steam_user_id) {
            setSteamDetails(result.steam_user_id);
        }
    });
}

checkIfAlreadyAuthenticate();
