ARG BASE_IMAGE=optio-base:latest
FROM ${BASE_IMAGE}

USER root

# Go
ENV GOVERSION=1.23.4
RUN curl -fsSL "https://go.dev/dl/go${GOVERSION}.linux-$(dpkg --print-architecture).tar.gz" \
    | tar -C /usr/local -xzf -
ENV PATH="/usr/local/go/bin:/home/agent/go/bin:${PATH}"
ENV GOPATH="/home/agent/go"

# protobuf compiler
RUN apt-get update && apt-get install -y protobuf-compiler \
    && rm -rf /var/lib/apt/lists/*

USER agent

# Go tools
RUN go install google.golang.org/protobuf/cmd/protoc-gen-go@latest \
    && go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest \
    && go install golang.org/x/tools/gopls@latest
