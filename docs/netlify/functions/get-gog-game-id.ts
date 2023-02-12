import { Handler, HandlerContext, HandlerEvent } from '@netlify/functions'
import { Apicalypse } from 'apicalypse';
import igdb from 'igdb-api-node';

const STEAM_CATEGORY_ID : number = 1;
const GOG_CATEGORY_ID : number = 5;

const { TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET } = process.env;

const handler: Handler = async (event : HandlerEvent, context : HandlerContext) => {

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const body : number[] = JSON.parse(event.body);

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

        // Split query into 10 games with multi query
        const queries = [];
        for (let i = 0; i < body.length; i += 10) {
            const query = client.query('games', `external_games_${i}`)
                                .fields(['name', 'external_games.*'])
                                .where(` external_games.uid = (${body.slice(i, i + 10).join(',')}) & external_games.category = ${STEAM_CATEGORY_ID}`);

            queries.push(query);
        }

        const response = await client.multi(queries).request('/multiquery');

        if (response.status !== 200) {
            return { statusCode: response.status, body: response.statusText };
        }
    
        if (response.data.length === 0) {
            return { statusCode: 404, body: 'No game found with the provided gameIds' };
        }

        // Get the GOG game ids
        const gogGameIds = [];
        for (const query of response.data) {
            for (const game of query.result) {
                const gogGame = game.external_games.find(externalGame => externalGame.category === GOG_CATEGORY_ID);
                
                if (gogGame) {
                    gogGameIds.push(gogGame.uid);
                } else {
                    gogGameIds.push(null);
                }
            }
        }

        return {
            statusCode: 200,
            body: JSON.stringify({ message: gogGameIds }),
        };
    })
    .catch(error => {
        return { statusCode: 500, body: error.toString() };
    });
};

export { handler }