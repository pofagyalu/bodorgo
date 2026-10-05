# The website (bodorgo.hu) as a Docker image: the built Angular app, served
# by Apache with the live site's own .htaccess (live.htaccess). Built from
# the repository's root - see compose.yaml and the root README's "Running
# it in Docker":
#
#   docker build -f client/Dockerfile -t bodorgo-web \
#     --build-arg API_BASE_URL=https://api.example.org .
#
# The API's address is written into the app when it is built, so a site
# under another address needs its own build.

FROM node:22-bookworm-slim AS build
WORKDIR /repo/client
COPY client/package.json client/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY client ./
# The one file the client takes from the server: the rules of a Futókör
# run (services/futokor.ts).
COPY server/src/futokor/runRules.js server/src/futokor/runRules.d.ts /repo/server/src/futokor/

# Where the API is, as browsers reach it. Empty: the live site's
# (src/environments/environment.ts).
ARG API_BASE_URL=
# The weather forecast's OpenWeatherMap key. Empty: the one in the file.
ARG OPENWEATHER_API_KEY=
RUN if [ -n "$API_BASE_URL" ]; then \
      sed -i "s#https://api.bodorgo.hu#${API_BASE_URL%/}#g" src/environments/environment.ts; \
    fi \
 && if [ -n "$OPENWEATHER_API_KEY" ]; then \
      sed -i -E "s#(openWeatherApi: *)'[^']*'#\1'${OPENWEATHER_API_KEY}'#" src/environments/environment.ts; \
    fi

# The version the app shows and compares with version.json
# (deploy-build.js) - there is no git inside the image.
ARG BUILD_COMMIT=docker
ARG BUILD_DATE=image
RUN BUILD_COMMIT="$BUILD_COMMIT" BUILD_DATE="$BUILD_DATE" node deploy-build.js

FROM httpd:2.4-alpine
# What the .htaccess needs: rewriting (the single-page app, the Brotli
# copies), gzip, and leave to be read at all.
RUN sed -i \
      -e 's/^#\(LoadModule rewrite_module \)/\1/' \
      -e 's/^#\(LoadModule deflate_module \)/\1/' \
      -e 's/AllowOverride None/AllowOverride All/' \
      -e 's/^#ServerName .*/ServerName localhost/' \
      conf/httpd.conf \
 && rm -f htdocs/index.html
COPY --from=build /repo/client/dist/client/browser/ htdocs/
COPY client/live.htaccess htdocs/.htaccess
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/version.json || exit 1
