FROM node:20-alpine

RUN apk add --no-cache openssl openssl-dev

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY prisma ./prisma/
RUN npx prisma generate

COPY src ./src/

RUN mkdir -p logs

EXPOSE 3000

CMD ["node", "src/index.js"]
