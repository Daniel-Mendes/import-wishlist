import { Handler, HandlerContext, HandlerEvent } from '@netlify/functions';
import axios from "axios";

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
    return fetch('https://id.twitch.tv/oauth2/token', {
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
    .then(data => {
        const queries = [];

        for (let i = 0; i < body.length; i+= 100) {
            let subQueries = "";

            for (let j = 0; j < body.length && j < 100; j+= 10) {
                const gameIds = body.slice(j, j + 10).join(',');
                subQueries += `query games "external_games_${j}" {
                                fields name, external_games.*;
                                where external_games.uid = (${gameIds})
                                    & external_games.category = ${STEAM_CATEGORY_ID};
                            };`;
            }

            const options = {
                method: 'POST',
                url: 'https://api.igdb.com/v4/multiquery',
                headers: {
                  'Content-Type': 'text/plain',
                  'Client-ID': TWITCH_CLIENT_ID,
                  Authorization: `Bearer ${data.access_token}`
                },
                data: subQueries
            };

            queries.push(axios.request(options));
        }

        return Promise.all(queries);
    })
    .then(responses => {
        responses = responses.flatMap(response => response.data).flat();

        const flattenedResponse = responses.reduce((acc, current) => {
            acc.push(...current.result);
            return acc;
        }, []);

        return flattenedResponse;
    })
    .then(data => {
        const games = [];

        for (const game of data) {
            const gogGame = game.external_games.find(externalGame  => externalGame .category === GOG_CATEGORY_ID);

            if (gogGame && gogGame.uid) {
                games.push(+gogGame.uid);
            } else {
                games.push(-1);
            }
        }

        return { statusCode: 200, body: JSON.stringify(games) };
    })
    .catch(error => {
        return { statusCode: 500, body: error.toString() };
    });
};

export { handler }