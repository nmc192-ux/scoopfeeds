FROM node:20-bookworm-slim AS build

WORKDIR /app

COPY backend/package*.json ./backend/
COPY frontend/package*.json ./frontend/

RUN npm ci --prefix backend
RUN npm ci --prefix frontend

COPY backend ./backend
COPY frontend ./frontend

RUN npm run build --prefix frontend

FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app/backend

COPY --from=build /app/backend /app/backend
COPY --from=build /app/frontend/dist /app/frontend/dist

EXPOSE 3000

CMD ["npm", "run", "start:web"]
