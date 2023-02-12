'use strict';

import igdb from 'igdb-api-node';

const STEAM_CATEGORY_ID = 1;
const GOG_CATEGORY_ID = 5;

const { TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET } = process.env;

exports.handler = async function (event, context) {

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const body = JSON.parse(event.body);

    if (!body || !body.steamWishlist) {
        return { statusCode: 400, body: 'Missing steamWishlist parameter' };
    }

    const { steamWishlist } = body;

    // Get the access token
    const { access_token } = await fetch('https://id.twitch.tv/oauth2/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            client_id: TWITCH_CLIENT_ID,
            client_secret: TWITCH_CLIENT_SECRET,
            grant_type: 'client_credentials',
        }),
    });

    const client = igdb(TWITCH_CLIENT_ID, access_token);

    const response = await client
                        .fields(["name", "external_games.category", "external_games.uid"])
                        .where(`external_games.uid = (${steamWishlist}) & external_games.category = ${STEAM_CATEGORY_ID}`)
                        .request("/games");

    if (response.status !== 200) {
        return { statusCode: response.status, body: response.statusText };
    }

    if (response.data.length === 0) {
        return { statusCode: 404, body: 'No game found with the provided gameIds' };
    }

    const gogGameIds = response.data.map(game => {
        const gogGame = game.external_games.find(externalGame => externalGame.category === GOG_CATEGORY_ID);

        if (!gogGame || !gogGame.uid) {
            return null;
        }
        
        return gogGame.uid;
    });

    return {
        statusCode: 200,
        body: JSON.stringify({ message: gogGameIds }),
    };
};