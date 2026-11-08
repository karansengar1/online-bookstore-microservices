# Build the React app, then serve the files with nginx. Build context: the project/ folder.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY gateway/package.json gateway/
COPY frontend/package.json frontend/
COPY services/user-service/package.json services/user-service/
COPY services/catalog-service/package.json services/catalog-service/
COPY services/cart-service/package.json services/cart-service/
COPY services/order-service/package.json services/order-service/
COPY services/notification-service/package.json services/notification-service/
RUN npm ci --workspace=frontend
COPY frontend frontend
WORKDIR /app/frontend
# The browser, not the container, talks to the gateway, so the address is the one on the host.
ARG VITE_API_URL=http://localhost:3000
ENV VITE_API_URL=${VITE_API_URL}
RUN npx vite build

FROM nginx:1.27-alpine
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
