FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production TZ=Europe/Brussels DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "src/server.js"]
