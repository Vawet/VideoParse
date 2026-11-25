FROM node:22-bookworm-slim AS build
WORKDIR /workspace
ENV VITE_PLATFORM=true VITE_API_BASE=/api
RUN npm install --global pnpm@10
COPY 前端/workspace/package.json 前端/workspace/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY 前端/workspace/ ./
RUN pnpm run build:prod

FROM nginx:stable-alpine
COPY --from=build /workspace/dist /usr/share/nginx/html
COPY infra/platform/nginx.conf /etc/nginx/conf.d/default.conf
