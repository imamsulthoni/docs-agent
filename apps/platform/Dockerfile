# Build from the repo root: docker build -f apps/platform/Dockerfile .
FROM node:20-slim AS build
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* .npmrc ./
COPY apps/platform/package.json apps/platform/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY services/ai-agent/package.json services/ai-agent/package.json
RUN corepack prepare pnpm@9.15.9 --activate && pnpm install --ignore-scripts
COPY apps/platform apps/platform
COPY packages/shared packages/shared
RUN pnpm --filter @docs-agent/platform build

FROM nginx:alpine
COPY --from=build /repo/apps/platform/dist /usr/share/nginx/html
EXPOSE 80
