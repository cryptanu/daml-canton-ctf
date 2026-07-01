FROM mcr.microsoft.com/devcontainers/typescript-node:1-22-bookworm

ARG DAML_SDK_VERSION=3.4.10

USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    openjdk-17-jdk-headless \
    unzip \
  && rm -rf /var/lib/apt/lists/*

USER node
RUN curl -fsSL https://get.daml.com/ | bash -s "${DAML_SDK_VERSION}"

USER root
RUN ln -s /home/node/.daml/bin/daml /usr/local/bin/daml

USER node
WORKDIR /workspaces/daml-canton-ctf
