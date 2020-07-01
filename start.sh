#!/bin/bash

docker rm -f trading-zoo-login
docker rmi hub.cgblockchain.com/trading-zoo/login

npm install --production=false
npm run build

./build.sh
./run.sh
