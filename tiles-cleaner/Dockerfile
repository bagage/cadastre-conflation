FROM debian:sid-slim

RUN apt update && \
    apt install -y unzip postgresql-client wget jq curl && \
    apt autoremove && apt clean

ARG VERSION="latest"
ARG FILE="tegola_linux_amd64.zip"

RUN curl -L -H 'Accept:application/octet-stream' \
    `test "$VERSION" = latest && curl -H "Accept: application/vnd.github.v3.raw" -s https://api.github.com/repos/go-spatial/tegola/releases/$VERSION | jq -r ".assets | map(select(.name == \"$FILE\"))[0].browser_download_url" || echo https://github.com/go-spatial/tegola/releases/download/$VERSION/tegola_linux_amd64.zip` \
    --output /tmp/$FILE && \
    unzip /tmp/$FILE -d /usr/bin && \
    rm /tmp/$FILE && \
    chmod +x /usr/bin/tegola

RUN mkdir /app

RUN adduser --disabled-password --no-create-home --gecos '' batimap

COPY config.toml /app/config.toml
COPY entrypoint.sh /

ENTRYPOINT ["/entrypoint.sh"]
