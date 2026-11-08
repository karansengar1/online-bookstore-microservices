# Image for one backend service or the gateway. Build with:  --build-arg SERVICE=services/user-service
FROM node:22-slim

ARG SERVICE
WORKDIR /app

# 1. Install only the dependencies of the chosen workspace. The package files are copied first,
#    so Docker can reuse this slow step as long as no package.json changes.
COPY package.json package-lock.json ./
COPY gateway/package.json gateway/
COPY frontend/package.json frontend/
COPY services/user-service/package.json services/user-service/
COPY services/catalog-service/package.json services/catalog-service/
COPY services/cart-service/package.json services/cart-service/
COPY services/order-service/package.json services/order-service/
COPY services/notification-service/package.json services/notification-service/
RUN npm ci --workspace=${SERVICE}

# 2. Then the source code.
COPY . .

WORKDIR /app/${SERVICE}
CMD ["node", "--import", "tsx", "src/index.ts"]
