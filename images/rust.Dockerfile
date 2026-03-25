ARG BASE_IMAGE=optio-base:latest
FROM ${BASE_IMAGE}

USER root

# Build tools
RUN apt-get update && apt-get install -y build-essential pkg-config libssl-dev \
    && rm -rf /var/lib/apt/lists/*

USER agent

# Rust via rustup
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/home/agent/.cargo/bin:${PATH}"

# Common tools
RUN cargo install cargo-watch cargo-nextest
