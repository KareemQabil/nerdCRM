# IOETI Business OS: one container for Railway (staging/pilot).
#   Caddy on $PORT serves the web app at / and proxies /axelor-erp to Tomcat on the same origin, rewriting
#   Axelor's cookie path so the app can read CSRF-TOKEN. PostgreSQL is Railway's managed database.
# Railway builds from the repository without git submodules, so the pinned Axelor sources are fetched here
# at the exact commits recorded in the repository (checked in CI by deploy/railway/check_pins.sh).

# --- 1. the web app (live mode: VITE_IOETI_DEMO is not set) ------------------------------------------------
FROM node:22-bookworm-slim AS web
WORKDIR /web
COPY apps/ioeti-web/package.json ./
RUN npm install --no-audit --no-fund
COPY apps/ioeti-web/ ./
RUN npm run build

# --- 2. the Axelor application (WAR) with the IOETI modules ------------------------------------------------
FROM eclipse-temurin:21-jdk AS war
ARG WEBAPP_SHA=dc50bc5a5c4006c607579bafa18c48564a951d6e
ARG AOS_SHA=e7cbea53bae88d2540f59a70b09bf0f326f1022e
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN git clone --filter=blob:none https://github.com/axelor/open-suite-webapp.git axelor-app \
 && git -C axelor-app checkout --quiet "$WEBAPP_SHA" \
 && git clone --filter=blob:none https://github.com/axelor/axelor-open-suite.git axelor-app/modules/axelor-open-suite \
 && git -C axelor-app/modules/axelor-open-suite checkout --quiet "$AOS_SHA"
COPY modules/ /src/modules/
RUN for m in /src/modules/ioeti-*; do ln -s "$m" "axelor-app/modules/$(basename "$m")"; done \
 && cd axelor-app && ./gradlew --no-daemon --max-workers=2 assemble -x archiveReports \
 && cp build/libs/*.war /src/axelor-erp.war

# --- 3. runtime ---------------------------------------------------------------------------------------------
FROM tomcat:10.1-jdk21-temurin
RUN apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/* \
 && rm -rf /usr/local/tomcat/webapps/*
COPY --from=caddy:2.8 /usr/bin/caddy /usr/bin/caddy
COPY --from=war /src/axelor-erp.war /usr/local/tomcat/webapps/axelor-erp.war
COPY --from=web /web/dist /srv/app
COPY infra/axelor/axelor-config.ioeti.template.properties /opt/ioeti/infra/axelor/
COPY scripts/ /opt/ioeti/scripts/
COPY deploy/railway/ /opt/ioeti/deploy/railway/
RUN chmod +x /opt/ioeti/deploy/railway/start.sh && mkdir -p /data
ENV IOETI_ROOT=/opt/ioeti CATALINA_HOME=/usr/local/tomcat
EXPOSE 8000
CMD ["/opt/ioeti/deploy/railway/start.sh"]
