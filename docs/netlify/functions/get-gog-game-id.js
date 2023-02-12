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

    if (!body) {
        return { statusCode: 400, body: 'Bad Request' };
    }

    // Get the access token
    return await fetch('https://id.twitch.tv/oauth2/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            client_id: TWITCH_CLIENT_ID,
            client_secret: TWITCH_CLIENT_SECRET,
            grant_type: 'client_credentials',
        }),
    })
    .then(response => response.json())
    .then(async data => {
        const client = igdb(TWITCH_CLIENT_ID, data.access_token);

        const response = await client
                            .fields(["name", "external_games.category", "external_games.uid"])
                            .where(`external_games.uid = (${body}) & external_games.category = ${STEAM_CATEGORY_ID}`)
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
    })
    .catch(error => {
        return { statusCode: 500, body: error.toString() };
    });
};