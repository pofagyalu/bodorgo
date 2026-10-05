# The API (api.bodorgo.hu) as a Docker image. Built from the repository's
# root - see compose.yaml and the root README's "Running it in Docker":
#
#   docker build -f server/Dockerfile -t bodorgo-api .
#
# It runs the source as it is (node src/server.js), not the one-file bundle
# the NAS gets (build.js): inside a Linux image npm installs every package
# for Linux itself, so nothing has to be shipped by hand (see sync.js).

FROM node:22-bookworm-slim AS packages
WORKDIR /app
COPY server/package.json server/package-lock.json ./
# Everything first, for the one file /docs needs out of a development
# package (Scalar's browser script - apiDocs/docsRouter.js looks for it
# here); then only what the running server uses is kept.
RUN npm ci --no-audit --no-fund \
 && mkdir apiDocs \
 && cp node_modules/@scalar/api-reference/dist/browser/standalone.js apiDocs/scalar.js \
 && npm prune --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim
# The club's days are Budapest days (reminders, when a tour is over).
ENV NODE_ENV=production \
    TZ=Europe/Budapest \
    PORT=8235
WORKDIR /app
COPY --from=packages /app/node_modules ./node_modules
COPY --from=packages /app/apiDocs ./apiDocs
COPY server/package.json ./
COPY server/assets ./assets
COPY server/scripts ./scripts
COPY server/src ./src

# What the server writes: uploads, chat photos, logs, thumbnails. Each is a
# volume in compose.yaml, so it outlives the container.
RUN mkdir -p documents chat-images logs /data/thumbnails \
 && chown node:node documents chat-images logs /data/thumbnails
USER node

# The version GET /health/version tells (utils/version.js) - there is no
# git inside the image.
ARG BUILD_COMMIT=
ARG BUILD_DATE=
ENV BUILD_COMMIT=$BUILD_COMMIT \
    BUILD_DATE=$BUILD_DATE

EXPOSE 8235
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "src/server.js"]
