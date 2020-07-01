FROM node:10-alpine as build-env

RUN apk --no-cache --virtual build-dependencies add alpine-sdk openssh python

WORKDIR /wrk

COPY package* ./

ARG NPMRC
ARG SSH_KEY

COPY package* ./

RUN echo "$NPMRC" > ~/.npmrc && \
  mkdir ~/.ssh && \
  echo "$SSH_KEY" > ~/.ssh/id_rsa && \
  chmod 400 ~/.ssh/id_rsa && \
  echo -e "Host gitlab.com\n    StrictHostKeyChecking no\n    UserKnownHostsFile=/dev/null" > ~/.ssh/config && \
  npm install && \
  rm -r ~/.ssh && \
  rm -f ~/.npmrc

COPY . ./
RUN npm run build

FROM node:10-alpine
WORKDIR /usr/src/app
COPY --from=build-env /wrk/node_modules ./node_modules
COPY --from=build-env /wrk/package* ./
COPY --from=build-env /wrk/config ./config
COPY --from=build-env /wrk/dist ./dist

ARG VERSION
ARG PROJECT_NAME
ARG COMMIT

LABEL version=${VERSION:-0.0.0}
LABEL name=${PROJECT_NAME}
LABEL commit=${COMMIT}

CMD [ "npm", "start" ]
