FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --ignore-scripts && npm rebuild better-sqlite3
COPY . .
ENV DB_PATH=/data/doza-pos.db
EXPOSE 5050
CMD ["node", "server.js"]