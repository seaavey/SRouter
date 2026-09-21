FROM node:22-alpine AS build

WORKDIR /app

ARG PUBLIC_SITE_URL=http://localhost:4321
ENV PUBLIC_SITE_URL=$PUBLIC_SITE_URL
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV COREPACK_ENABLE_PROJECT_SPEC=0

RUN corepack enable && corepack prepare pnpm@11.23.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/docs/package.json ./apps/docs/

RUN pnpm install --frozen-lockfile

COPY apps/docs ./apps/docs
RUN pnpm --filter docs build

FROM nginx:1.27-alpine AS runner

COPY apps/docs/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/docs/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
