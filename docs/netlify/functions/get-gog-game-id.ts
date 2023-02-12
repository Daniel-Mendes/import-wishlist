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
        let queries = "";

        for (let i = 0; i < body.length; i+= 10) {
            const gameIds = body.slice(i, i + 10).join(',');
            queries += `query games "external_games_${i}" {
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
            data: queries
          };
          
          return axios.request(options)
          .then(function (response) {
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
          }).catch(function (error) {
            console.error(error);

            return { statusCode: 500, body: error.toString() };
          });
    })
    .catch(error => {
        return { statusCode: 500, body: error.toString() };
    });
};

export { handler }