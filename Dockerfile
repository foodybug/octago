FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 LEADERBOARD_FILE=/data/leaderboard.json

COPY package.json server.cjs leaderboard.cjs engine.js platform.js ./
COPY index.html style.css app.js lobby.js config.js ./

EXPOSE 3000
CMD ["node", "server.cjs"]
