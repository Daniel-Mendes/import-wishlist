let gogLoginWidth = 393;
let gogLoginHeight = 500;
let gogLoginleft = Math.floor((screen.width/2)-(gogLoginWidth/2));
let gogLoginTop = Math.floor((screen.height/2)-(gogLoginHeight/2));

document.getElementById('btn-gog-login').addEventListener('click', function() {
    chrome.windows.create({
        url: 'https://login.gog.com/auth?client_id=46899977096215655&redirect_uri=https%3A%2F%2Fembed.gog.com%2Fon_login_success%3Forigin%3Dclient&response_type=code&layout=client2',
        type: 'popup',
        width: gogLoginWidth,
        height: gogLoginHeight,
        top: gogLoginTop,
        left: gogLoginleft,
    });
});

document.getElementById('btn-steam-login').addEventListener('click', function() {
    let extensionRedirectURL =  chrome.identity.getRedirectURL();
    
    let steamOpenIDParams = {
        'openid.ns'         : 'http://specs.openid.net/auth/2.0',
        'openid.mode'       : 'checkid_setup',
        'openid.return_to'  : extensionRedirectURL,
        'openid.realm'      : extensionRedirectURL,
        'openid.identity'   : 'http://specs.openid.net/auth/2.0/identifier_select',
        'openid.claimed_id' : 'http://specs.openid.net/auth/2.0/identifier_select',
    };

    chrome.identity.launchWebAuthFlow({
        url: "https://steamcommunity.com/openid/login?" + new URLSearchParams(steamOpenIDParams),
        interactive: true,
    }, function(response) {
        let queryParameters = decodeURI(response).split('?')[1];
        let urlParameters = new URLSearchParams(queryParameters);
        let claimed_id = urlParameters.get('openid.claimed_id');
        let steamUserID = claimed_id.split('/')[claimed_id.split('/').length - 1];
        chrome.storage.local.set({'steam_user_id': steamUserID}, function() {
            setSteamDetails(steamUserID);
        });
    });
});

document.getElementById('btn-import-wishlist').addEventListener('click', function() {
    chrome.storage.local.get(['gog_access_token', 'steam_user_id'], function(result) {
        if (!result.gog_access_token) {
            return alert('Please connect to your GOG.com account', timeout);
        }
        
        if (!result.steam_user_id) {
            return alert('Please connect to your Steam account', 5000);
        }

        importWhishlist();
    });
});

chrome.runtime.onMessage.addListener((request, sender, response) => {
    if (request.type === 'gogLogin') {
        chrome.tabs.query({
            url: 'https://embed.gog.com/on_login_success?origin=client*'
        }, function (tabs) {
            chrome.tabs.remove(tabs[0].id);
        });
       chrome.windows.create({
            url: 'https://auth.gog.com/token?' + new URLSearchParams({
                client_id: '46899977096215655',
                client_secret: '9d85c43b1482497dbbce61f6e4aa173a433796eeae2ca8c5f6129f2dc4de46d9',
                grant_type: 'authorization_code',
                code: request.code,
                redirect_uri: encodeURI('https://embed.gog.com/on_login_success?origin=client')
        }),
            type: 'popup',
            width: gogLoginWidth,
            height: gogLoginHeight,
            top: gogLoginTop,
            left: gogLoginleft,
        });
    }

    if (request.type === 'gogTokenSuccess') {
        chrome.tabs.query({
            url: 'https://auth.gog.com/token*'
        }, function (tabs) {
            chrome.tabs.remove(tabs[0].id);
        });
        alert('Your GOG.com account is now connected', 5000);
        setGogDetails(request.gog_access_token);
    }
});

function checkIfAlreadyAuthenticate() {
    chrome.storage.local.get(['gog_access_token', 'steam_user_id'], function(result) {
        if (result.gog_access_token) {
            refrechAccessToken().then(function(access_token) {
                setGogDetails(access_token);
            });
        }

        if (result.steam_user_id) {
            setSteamDetails(result.steam_user_id);
        }
    });
}

function setSteamDetails(steam_user_id) {
    fetch('https://steamcommunity.com/profiles/' + steam_user_id + '/?xml=1')
    .then(response => {
        response.text()
        .then(function(content) {
            let parser = new DOMParser();
            let xmlDoc = parser.parseFromString(content, "text/xml");
            return xmlDoc;
        })
        .then(xmlDoc => {
            document.getElementById('btn-steam-login').style.display = 'none';
            document.getElementById('steam-avatar').src = xmlDoc.getElementsByTagName('avatarFull')[0].childNodes[0].nodeValue;
            document.getElementById('steam-name').href = "https://store.steampowered.com/wishlist/id/" + xmlDoc.getElementsByTagName('customURL')[0].childNodes[0].nodeValue;
            document.getElementById('steam-name').innerText = xmlDoc.getElementsByTagName('steamID')[0].childNodes[0].nodeValue;
            document.getElementById('details-steam').style.display = 'block';
        });;
    })
}

function setGogDetails(gog_access_token) {
    fetch('https://menu.gog.com/v1/account/basic', {
        headers: {
            'Authorization': 'Bearer ' + gog_access_token,
        }
    })
    .then(response => {
        if (response.status === 401) {
            refrechAccessToken();
        } else {
           return response.json()
        }
    }).then(data => {
        document.getElementById('btn-gog-login').style.display = 'none';
        document.getElementById('gog-avatar').src = data.avatars['menu_user_av_big2'];
        document.getElementById('gog-name').innerText = data.username;
        document.getElementById('gog-name').href = 'https://www.gog.com/u/' +  data.username + '/wishlist';
        document.getElementById('details-gog').style.display = 'block';
    });
}

async function refrechAccessToken() {
    return new Promise((resolve, reject) => {
        chrome.storage.local.get(['gog_refresh_token'], function(result) {
            if (result.gog_refresh_token) {
                fetch('https://auth.gog.com/token?' + new URLSearchParams({
                    client_id: '46899977096215655',
                    client_secret: '9d85c43b1482497dbbce61f6e4aa173a433796eeae2ca8c5f6129f2dc4de46d9',
                    grant_type: 'refresh_token',
                    refresh_token: result.gog_refresh_token,
                }), {
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                }).then(response => response.json()).then(data => {
                    chrome.storage.local.set({
                        gog_access_token: data.access_token,
                        gog_refresh_token: data.refresh_token,
                    }, function() {
                        resolve(data.access_token);
                    });
                });
            } else {
                alert('Please connect to your GOG.com account', 5000);
            }
        });
    });
}

function importWhishlist() {
    document.getElementById('icon-rotate').classList.add('icon-spin');

    if (document.getElementById('delete-all-wishlist').checked) {
        removeAllFromWishlist()
        .then(() => {
            getSteamWishlist()
            .then(steamWishlist => {
                addSteamWishlistToGog(steamWishlist, true)
                .then(results => {
                    document.getElementById('delete-all-wishlist').checked = false;
                    document.getElementById('icon-rotate').classList.remove('icon-spin');
                    alert("Games added : " + results['added'] + "\n Games not found : " + results['notFound'] + "\n Games already in wishlist : " + results['alreadyInWishlist'], 10000);
                });
            });
        });
    } else {
        getSteamWishlist()
        .then(steamWishlist => {
            addSteamWishlistToGog(steamWishlist, false)
            .then(results => {
                document.getElementById('icon-rotate').classList.remove('icon-spin');
                alert("Games added : " + results['added'] + "\n Games not found : " + results['notFound'] + "\n Games already in wishlist : " + results['alreadyInWishlist'], 10000);
            });
        });
    }
}

async function getGogWishlist() {
    return new Promise((resolve, reject) => {
        chrome.storage.local.get(['gog_access_token'], function(result) {
            if (result.gog_access_token) {
                fetch('https://embed.gog.com/user/wishlist.json', {
                    method: 'GET',
                    headers: {
                        'Authorization': 'Bearer ' + result.gog_access_token,
                        'Accept': 'application/json',
                        'Content-Type': 'application/json'
                    }
                }).then(response => {
                    return response.json();
                }).then(data => {
                    let gogWishlistID = [];
                    Object.entries(data.wishlist).forEach(item => {
                        const [id, boolean] = item;
                        gogWishlistID.push(id);
                    });
                    resolve(gogWishlistID);
                }).catch(error => {
                    console.log(error);
                });
            } else {
                alert('Please connect to your GOG.com account', 5000);
            }
        });
    });
}

async function getSteamWishlist() {
    return new Promise((resolve, reject) => {
        chrome.storage.local.get(['steam_user_id'], async function(result) {
            let page_number = 0;
            let steamWishlist = [];
    
            // Fetch all pages while data not empty
            while (true) {
                
                let request = await fetch('https://store.steampowered.com/wishlist/profiles/' + result.steam_user_id + '/wishlistdata?p=' + page_number , {
                    method: 'GET',
                    headers: {
                        'Accept': 'application/json',
                        'Content-Type': 'application/json'
                    }
                })
                
                let data = await request.json();
               
                if (data.length == 0) {
                    break;
                } else {
                    Object.entries(data).forEach(item => {
                        steamWishlist.push(item[1].name);
                    });
        
                    page_number++;
                }
            };
            resolve(steamWishlist);
        });
    });
}

async function addSteamWishlistToGog(steamWishlist, gogWishlistWiped) {
    let results = {
        added : 0,
        notFound : 0,
        alreadyInWishlist : 0,
    };

    const requests = steamWishlist.map((game) => fetch('https://embed.gog.com/games/ajax/filtered?mediaType=game&search=' + game)); 
    const responses = await Promise.all(requests); 
    const promises = responses.map((response) => response.json());
    const data = await Promise.all(promises);
    data.map((search, index) => {
        if (search.products.length == 0) {
            results['notFound']++;
        } else if (search.products.length == 1) {
            if (steamWishlist.includes(search.products[0].title) && !gogWishlistWiped) {
                results['alreadyInWishlist']++;
            } else {
                fetch('https://embed.gog.com/user/wishlist/add/' + search.products[0].id);
                results['added']++;
            }
        } else {
            search.products.map((product) => {
                if (product.title.toLowerCase() === steamWishlist[index].toLowerCase()) {
                    if (steamWishlist.includes(product.title) && !gogWishlistWiped) {
                        results['alreadyInWishlist']++;
                    } else {
                        fetch('https://embed.gog.com/user/wishlist/add/' + product.id);
                        results['added']++;
                    }
                }
            });
        }
    });

    return results;
}

async function removeAllFromWishlist() {
    new Promise((resolve, reject) => {
        getGogWishlist()
        .then(gogWishlist => {
            for (let i = 0; i < gogWishlist.length; i++) {
                fetch('https://embed.gog.com/user/wishlist/remove/' + gogWishlist[i]);
            }
            resolve();
        });
    });
}

function alert(message, timeout) {
    document.getElementById('alert').innerText = message;
    document.getElementById('alert').style.display = 'block';
    setTimeout(() => {
        document.getElementById('alert').style.display = 'none';
    }, timeout);
}

// removeAllFromWishlist();

checkIfAlreadyAuthenticate();